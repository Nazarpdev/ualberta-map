using NetTopologySuite.Features;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;

namespace MapApp.Services
{
    public class RoutingService
    {
        private readonly Dictionary<Coordinate, List<(Coordinate neighbor, double distance)>> _graph = new();
        private readonly List<(Coordinate a, Coordinate b)> _walkways = new();
        private readonly List<Geometry> _buildings = new();
        private readonly List<Geometry> _subBuildings = new();
        private readonly Dictionary<string, Geometry> _locations = new();
        private readonly Dictionary<Geometry, List<Coordinate>> _connections = new();
        private const double EdgeSnapTolerance = 0.00001;
        private static readonly HashSet<string> PedestrianHighways = new(StringComparer.OrdinalIgnoreCase)
        {
            "footway", "path", "pedestrian", "steps", "cycleway"
        };

        public RoutingService() : this("wwwroot/map.geojson") { }

        public RoutingService(string geoJsonPath)
        {
            var features = new GeoJsonReader().Read<FeatureCollection>(File.ReadAllText(geoJsonPath));
            var pedestrian = new HashSet<Coordinate>();
            var indoor = new HashSet<Coordinate>();
            var entrances = new List<Coordinate>();
            foreach (var feature in features)
            {
                var geometry = feature.Geometry;
                var name = Tag(feature, "name");
                if (name != null) _locations[name] = geometry;
                if (geometry is Polygon or MultiPolygon && Tag(feature, "building") != null)
                {
                    _buildings.Add(geometry);
                    if (name == "Students' Union Building") _subBuildings.Add(geometry);
                }
                if (geometry is Point point && Tag(feature, "entrance") is string entrance
                    && entrance is not ("no" or "emergency" or "exit"))
                    entrances.Add(point.Coordinate);
                if (geometry is not LineString line) continue;

                var walkable = PedestrianHighways.Contains(Tag(feature, "highway") ?? "")
                    || Tag(feature, "indoor") == "corridor";
                var covered = Tag(feature, "indoor") is "yes" or "corridor"
                    || Tag(feature, "bridge") is "yes" or "pedestrian"
                    || Tag(feature, "man_made") == "bridge"
                    || Tag(feature, "tunnel") is "yes" or "covered";
                var coords = line.Coordinates;
                for (int i = 0; i < coords.Length - 1; i++)
                {
                    AddEdge(_graph, coords[i], coords[i + 1]);
                    if (walkable) _walkways.Add((coords[i], coords[i + 1]));
                }
                if (walkable) pedestrian.UnionWith(coords);
                if (walkable && covered) indoor.UnionWith(coords);
            }

            foreach (var building in _buildings)
            {
                var area = building.Buffer(EdgeSnapTolerance);
                // Outdoor access must use a mapped door; pedway/indoor connections may
                // land just beyond the footprint. A nearby sidewalk is not an entrance.
                var nodes = pedestrian.Where(c => building.Contains(new Point(c))
                    || (area.Covers(new Point(c)) && (indoor.Contains(c)
                        || entrances.Any(e => e.Distance(c) <= EdgeSnapTolerance)))).ToList();
                _connections[building] = nodes;
                // The source map has pedways and doors but often no interior corridors.
                // Connect visible access points inside the footprint, never across a courtyard.
                for (int i = 0; i < nodes.Count; i++)
                    for (int j = i + 1; j < nodes.Count; j++)
                        if (area.Covers(new LineString([nodes[i], nodes[j]])))
                            AddEdge(_graph, nodes[i], nodes[j]);
            }
        }

        private static string? Tag(IFeature feature, string key)
            => feature.Attributes?.Exists(key) == true ? feature.Attributes[key]?.ToString() : null;

        private static void AddEdge(Dictionary<Coordinate, List<(Coordinate neighbor, double distance)>> graph,
            Coordinate a, Coordinate b)
        {
            if (!graph.ContainsKey(a)) graph[a] = [];
            if (!graph.ContainsKey(b)) graph[b] = [];
            if (a.Equals2D(b)) return;
            graph[a].Add((b, a.Distance(b)));
            graph[b].Add((a, a.Distance(b)));
        }

        private Geometry? BuildingAt(Coordinate point, string? name)
        {
            if (name != null && _locations.TryGetValue(name, out var geometry) && _connections.ContainsKey(geometry))
                return geometry;
            return _buildings.FirstOrDefault(b => b.Covers(new Point(point)));
        }

        private Dictionary<Coordinate, double> Attach(Coordinate point, Geometry? building, bool named,
            Dictionary<Coordinate, List<(Coordinate neighbor, double distance)>> graph, out Coordinate? projection)
        {
            projection = null;
            if (building != null)
            {
                var area = building.Buffer(EdgeSnapTolerance);
                var nodes = _connections[building];
                if (named) return nodes.ToDictionary(c => c, _ => 0.0);
                foreach (var node in nodes)
                    if (point.Equals2D(node) || area.Covers(new LineString([point, node])))
                        AddEdge(graph, point, node);
                return graph.ContainsKey(point) ? new() { [point] = 0 } : new();
            }

            // Snap to a segment rather than its nearest vertex, retaining the exact marker.
            // Reject connectors through buildings instead of drawing through their walls.
            var candidates = _walkways.Where(edge => graph[edge.a].Any(e => e.neighbor.Equals2D(edge.b))).Select(edge =>
            {
                var projected = new LineSegment(edge.a, edge.b).ClosestPoint(point);
                return (edge, projected, distance: point.Distance(projected));
            }).OrderBy(c => c.distance);
            foreach (var candidate in candidates)
            {
                var connector = new LineString([point, candidate.projected]);
                if (_buildings.Any(b => b.Contains(new Point(candidate.projected))
                    || (connector.Length > 0 && connector.Relate(b, "T********")))) continue;
                AddEdge(graph, point, candidate.projected);
                AddEdge(graph, candidate.projected, candidate.edge.a);
                AddEdge(graph, candidate.projected, candidate.edge.b);
                projection = candidate.projected;
                return new() { [point] = 0 };
            }
            return new();
        }

        public List<double[]> GetRoute(double slat, double slon, double elat, double elon,
            string? startName = null, string? endName = null, bool avoidSub = false)
        {
            var requestedStart = new Coordinate(slon, slat);
            var requestedEnd = new Coordinate(elon, elat);
            var startBuilding = BuildingAt(requestedStart, startName);
            var endBuilding = BuildingAt(requestedEnd, endName);
            // Request-local edges keep concurrent routes from modifying the singleton graph.
            var graph = _graph.ToDictionary(p => p.Key, p => new List<(Coordinate neighbor, double distance)>(p.Value));
            // Indoor requests hand off at a specific SUB entrance. Their campus leg
            // must not enter another door and take the old footprint shortcut through SUB.
            if (avoidSub)
            {
                foreach (var (node, edges) in graph)
                    edges.RemoveAll(edge => _subBuildings.Any(building =>
                        new LineString([node, edge.neighbor]).Relate(building, "T********")));
                if (startBuilding != null && _subBuildings.Contains(startBuilding)) startBuilding = null;
                if (endBuilding != null && _subBuildings.Contains(endBuilding)) endBuilding = null;
            }
            var starts = Attach(requestedStart, startBuilding, startName != null, graph, out var startProjection);
            var ends = Attach(requestedEnd, endBuilding, endName != null, graph, out var endProjection);
            if (startBuilding != null && ReferenceEquals(startBuilding, endBuilding)
                && startName == null && endName == null
                && startBuilding.Covers(new LineString([requestedStart, requestedEnd])))
                return [[slat, slon], [elat, elon]];
            if (starts.Count == 0 || ends.Count == 0) return [];

            // Join projections on the same mapped segment without a detour to its vertices.
            if (startProjection != null && endProjection != null)
            {
                if (_walkways.Any(e => new LineSegment(e.a, e.b).Distance(startProjection) < 1e-12
                    && new LineSegment(e.a, e.b).Distance(endProjection) < 1e-12))
                    AddEdge(graph, startProjection, endProjection);
            }

            var dist = new Dictionary<Coordinate, double>(starts);
            var prev = new Dictionary<Coordinate, Coordinate>();
            var queue = new PriorityQueue<Coordinate, double>();
            foreach (var (node, cost) in starts) queue.Enqueue(node, cost);
            Coordinate? end = null;
            while (queue.TryDequeue(out var current, out var cost))
            {
                if (cost > dist[current]) continue;
                if (ends.ContainsKey(current)) { end = current; break; }
                foreach (var (neighbor, distance) in graph[current])
                {
                    var next = cost + distance;
                    if (dist.TryGetValue(neighbor, out var known) && next >= known) continue;
                    dist[neighbor] = next;
                    prev[neighbor] = current;
                    queue.Enqueue(neighbor, next);
                }
            }
            if (end == null) return [];
            var path = new List<Coordinate> { end };
            while (prev.TryGetValue(path[^1], out var parent)) path.Add(parent);
            path.Reverse();
            // Only named buildings stop at their edge. Markers always retain exact coordinates.
            if (startName != null && startBuilding != null) TrimBuilding(path, startBuilding, true);
            if (endName != null && endBuilding != null) TrimBuilding(path, endBuilding, false);
            return path.Select(c => new[] { c.Y, c.X }).ToList();
        }

        private static void TrimBuilding(List<Coordinate> path, Geometry building, bool start)
        {
            if (start) path.Reverse();
            for (int i = 0; i < path.Count - 1; i++)
            {
                var segment = new LineString([path[i], path[i + 1]]);
                var crossing = building.Boundary.Intersection(segment);
                if (crossing.IsEmpty) continue;
                var edge = crossing.Coordinates.MinBy(c => c.Distance(path[i]))!;
                path.RemoveRange(i + 1, path.Count - i - 1);
                if (!path[^1].Equals2D(edge)) path.Add(edge);
                break;
            }
            if (start) path.Reverse();
        }

        public Dictionary<string, double[]> GetLocations()
            => _locations.ToDictionary(p => p.Key, p =>
            {
                var point = p.Value is Polygon or MultiPolygon ? p.Value.InteriorPoint : p.Value.Centroid;
                return new[] { point.Y, point.X };
            });
    }
}
