using NetTopologySuite.Features;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;

namespace MapApp.Services
{
    public class RoutingService
    {
        // Corners belong to one building even when adjacent footprints share coordinates.
        private sealed record Node(Coordinate Position, Geometry? InteriorOf = null)
        {
            public static implicit operator Node(Coordinate position) => new(position);
        }
        private readonly Dictionary<Node, List<(Node neighbor, double distance, bool indoor)>> _graph = new();
        private readonly List<(Coordinate a, Coordinate b, bool indoor)> _walkways = new();
        private readonly List<Geometry> _buildings = new();
        private readonly List<Geometry> _subBuildings = new();
        private readonly Dictionary<string, Geometry> _locations = new();
        private readonly Dictionary<Geometry, List<Node>> _connections = new();
        private readonly Dictionary<Geometry, List<Node>> _interiorCorners = new();
        private readonly Dictionary<Geometry, Geometry> _visibilityAreas = new();
        private const double EdgeSnapTolerance = 0.00001;
        // This penalty also bounds the preferred route to 1.5x the shortest distance.
        private const double OutdoorCostMultiplier = 1.5;
        private static readonly HashSet<string> PedestrianHighways = new(StringComparer.OrdinalIgnoreCase)
        {
            "footway", "path", "pedestrian", "steps", "cycleway"
        };

        public RoutingService() : this("wwwroot/map.geojson", "wwwroot/routing-overrides.geojson") { }

        public RoutingService(string geoJsonPath, string? overridesPath = null)
        {
            var reader = new GeoJsonReader();
            var features = reader.Read<FeatureCollection>(File.ReadAllText(geoJsonPath)).ToList();
            if (overridesPath != null)
            {
                // Keep local topology corrections separate from the imported map. Replacing
                // a way lets us add a junction without joining grade-separated crossings.
                foreach (var feature in reader.Read<FeatureCollection>(File.ReadAllText(overridesPath)))
                {
                    var id = Tag(feature, "@id");
                    if (id != null) features.RemoveAll(existing => Tag(existing, "@id") == id);
                    features.Add(feature);
                }
            }
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
                    AddEdge(_graph, coords[i], coords[i + 1], walkable && covered);
                    if (walkable) _walkways.Add((coords[i], coords[i + 1], covered));
                }
                if (walkable) pedestrian.UnionWith(coords);
                if (walkable && covered) indoor.UnionWith(coords);
            }

            foreach (var building in _buildings)
            {
                // Micrometre-scale tolerance handles rounding at projected boundary
                // endpoints, without the metre-scale corner cutting of access snapping.
                _visibilityAreas[building] = building.Buffer(1e-10);
                var area = building.Buffer(EdgeSnapTolerance);
                // Outdoor access must use a mapped door; pedway/indoor connections may
                // land just beyond the footprint. A nearby sidewalk is not an entrance.
                var nodes = pedestrian.Where(c => building.Contains(new Point(c))
                    || (area.Covers(new Point(c)) && (indoor.Contains(c)
                        || entrances.Any(e => e.Distance(c) <= EdgeSnapTolerance)))).Select(c => new Node(c)).ToList();
                _connections[building] = nodes;
                var corners = InteriorCorners(building).Distinct().ToList();
                _interiorCorners[building] = corners;
                var interiorNodes = nodes.Concat(corners).Distinct().ToList();
                foreach (var corner in corners) _graph.TryAdd(corner, []);
                // The source map has pedways and doors but often no interior corridors.
                // Interior corners allow turns around concave walls and courtyards.
                // They are not entrances and must never join another building or sidewalk.
                for (int i = 0; i < interiorNodes.Count; i++)
                    for (int j = i + 1; j < interiorNodes.Count; j++)
                    {
                        if (VisibleInside(building, interiorNodes[i].Position, interiorNodes[j].Position))
                            AddEdge(_graph, interiorNodes[i], interiorNodes[j], indoor: true);
                    }
            }
        }

        private static IEnumerable<Node> InteriorCorners(Geometry building)
        {
            for (int part = 0; part < building.NumGeometries; part++)
            {
                var polygon = (Polygon)building.GetGeometryN(part);
                for (int ringIndex = -1; ringIndex < polygon.NumInteriorRings; ringIndex++)
                {
                    var ring = ringIndex < 0 ? polygon.ExteriorRing : polygon.GetInteriorRingN(ringIndex);
                    var coords = ring.Coordinates;
                    // A hole's walkable side is the opposite of its enclosed side.
                    var interiorOnLeft = NetTopologySuite.Algorithm.Orientation.IsCCW(coords) != (ringIndex >= 0);
                    var side = interiorOnLeft ? 1 : -1;
                    for (int i = 0; i < coords.Length - 1; i++)
                    {
                        var previous = coords[(i + coords.Length - 2) % (coords.Length - 1)];
                        var corner = coords[i];
                        var next = coords[i + 1];
                        if ((int)NetTopologySuite.Algorithm.Orientation.Index(previous, corner, next) != -side) continue;
                        // Use the actual reflex vertex: an inset can lose visibility around
                        // a narrow bend and make a request-local marker invent a shortcut.
                        yield return new Node(corner, building);
                    }
                }
            }
        }

        private static string? Tag(IFeature feature, string key)
            => feature.Attributes?.Exists(key) == true ? feature.Attributes[key]?.ToString() : null;

        private bool VisibleInside(Geometry building, Coordinate a, Coordinate b)
        {
            // A mapped access node may be just outside its footprint. Snap only
            // that endpoint for visibility; buffering the whole footprint lets
            // marker attachments cut corners that the shared graph cannot use.
            Coordinate Snap(Coordinate coordinate)
            {
                var point = new Point(coordinate);
                if (building.Covers(point)) return coordinate;
                var nearest = NetTopologySuite.Operation.Distance.DistanceOp.NearestPoints(building, point)[0];
                return nearest.Distance(coordinate) <= EdgeSnapTolerance ? nearest : coordinate;
            }
            return _visibilityAreas[building].Covers(new LineString([Snap(a), Snap(b)]));
        }

        private static void AddEdge(Dictionary<Node, List<(Node neighbor, double distance, bool indoor)>> graph,
            Node a, Node b, bool indoor = false)
        {
            if (!graph.ContainsKey(a)) graph[a] = [];
            if (!graph.ContainsKey(b)) graph[b] = [];
            if (a == b) return;
            // Local equirectangular distance in metres, correcting longitude at campus latitude.
            var dx = (b.Position.X - a.Position.X) * Math.Cos((a.Position.Y + b.Position.Y) * Math.PI / 360);
            var dy = b.Position.Y - a.Position.Y;
            var distance = Math.Sqrt(dx * dx + dy * dy) * Math.PI / 180 * 6371000;
            graph[a].Add((b, distance, indoor));
            graph[b].Add((a, distance, indoor));
        }

        private Geometry? BuildingAt(Coordinate point, string? name)
        {
            if (name != null && _locations.TryGetValue(name, out var geometry) && _connections.ContainsKey(geometry))
                return geometry;
            return _buildings.FirstOrDefault(b => b.Covers(new Point(point)));
        }

        private Dictionary<Node, double> Attach(Coordinate point, Geometry? building, bool named,
            Dictionary<Node, List<(Node neighbor, double distance, bool indoor)>> graph, out Coordinate? projection)
        {
            projection = null;
            if (building != null)
            {
                var nodes = _connections[building];
                if (named) return nodes.ToDictionary(c => c, _ => 0.0);
                // A pin on an existing route splits that route's edges. Giving it
                // additional visibility links would make a through-route cheaper
                // only after the user inserts a waypoint on it.
                var onEdges = _graph.SelectMany(entry => entry.Value.Select(edge => (from: entry.Key, edge)))
                    .Where(item => item.edge.indoor && graph[item.from].Contains(item.edge)
                        && !point.Equals2D(item.from.Position) && !point.Equals2D(item.edge.neighbor.Position)
                        && new LineSegment(item.from.Position, item.edge.neighbor.Position).Distance(point) < 1e-12)
                    .ToList();
                if (onEdges.Count > 0)
                {
                    foreach (var (from, edge) in onEdges)
                    {
                        AddEdge(graph, point, from, edge.indoor);
                        AddEdge(graph, point, edge.neighbor, edge.indoor);
                    }
                    return new() { [point] = 0 };
                }
                foreach (var node in nodes)
                    if (point.Equals2D(node.Position) || VisibleInside(building, point, node.Position))
                        AddEdge(graph, point, node, indoor: true);
                foreach (var corner in _interiorCorners[building])
                    if (point.Equals2D(corner.Position) || VisibleInside(building, point, corner.Position))
                        AddEdge(graph, point, corner, indoor: true);
                return graph.ContainsKey(point) ? new() { [point] = 0 } : new();
            }

            // Snap to a segment rather than its nearest vertex, retaining the exact marker.
            // Reject connectors through buildings instead of drawing through their walls.
            var candidates = _walkways.Where(edge => graph[edge.a].Any(e => e.neighbor.Position.Equals2D(edge.b))).Select(edge =>
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
                AddEdge(graph, candidate.projected, candidate.edge.a, candidate.edge.indoor);
                AddEdge(graph, candidate.projected, candidate.edge.b, candidate.edge.indoor);
                projection = candidate.projected;
                return new() { [point] = 0 };
            }
            return new();
        }

        public List<double[]> GetRoute(double slat, double slon, double elat, double elon,
            string? startName = null, string? endName = null, bool avoidSub = false, bool preferIndoor = false)
            => GetRouteDetails(slat, slon, elat, elon, startName, endName, avoidSub, preferIndoor).Coordinates;

        public record RouteDetails(List<double[]> Coordinates, double Cost);

        public RouteDetails GetRouteDetails(double slat, double slon, double elat, double elon,
            string? startName = null, string? endName = null, bool avoidSub = false, bool preferIndoor = false)
        {
            var requestedStart = new Coordinate(slon, slat);
            var requestedEnd = new Coordinate(elon, elat);
            var startBuilding = BuildingAt(requestedStart, startName);
            var endBuilding = BuildingAt(requestedEnd, endName);
            // Request-local edges keep concurrent routes from modifying the singleton graph.
            var graph = _graph.ToDictionary(p => p.Key, p => new List<(Node neighbor, double distance, bool indoor)>(p.Value));
            // Indoor requests hand off at a specific SUB entrance. Their campus leg
            // must not enter another door and take the old footprint shortcut through SUB.
            if (avoidSub)
            {
                foreach (var (node, edges) in graph)
                    edges.RemoveAll(edge => _subBuildings.Any(building =>
                        new LineString([node.Position, edge.neighbor.Position]).Relate(building, "T********")));
                if (startBuilding != null && _subBuildings.Contains(startBuilding)) startBuilding = null;
                if (endBuilding != null && _subBuildings.Contains(endBuilding)) endBuilding = null;
            }
            var starts = Attach(requestedStart, startBuilding, startName != null, graph, out var startProjection);
            var ends = Attach(requestedEnd, endBuilding, endName != null, graph, out var endProjection);
            if (startBuilding != null && ReferenceEquals(startBuilding, endBuilding)
                && startName == null && endName == null
                && startBuilding.Covers(new LineString([requestedStart, requestedEnd])))
            {
                AddEdge(graph, requestedStart, requestedEnd, indoor: true);
                var cost = graph[requestedStart].FirstOrDefault(e => e.neighbor.Position.Equals2D(requestedEnd)).distance;
                return new([[slat, slon], [elat, elon]], cost);
            }
            if (starts.Count == 0 || ends.Count == 0) return new([], 0);

            // Join projections on the same mapped segment without a detour to its vertices.
            if (startProjection != null && endProjection != null)
            {
                foreach (var edge in _walkways.Where(e => new LineSegment(e.a, e.b).Distance(startProjection) < 1e-12
                    && new LineSegment(e.a, e.b).Distance(endProjection) < 1e-12))
                    AddEdge(graph, startProjection, endProjection, edge.indoor);
            }

            var dist = new Dictionary<Node, double>(starts);
            var prev = new Dictionary<Node, Node>();
            var queue = new PriorityQueue<Node, double>();
            foreach (var (node, cost) in starts) queue.Enqueue(node, cost);
            Node? end = null;
            while (queue.TryDequeue(out var current, out var cost))
            {
                if (cost > dist[current]) continue;
                if (ends.ContainsKey(current)) { end = current; break; }
                foreach (var (neighbor, distance, indoor) in graph[current])
                {
                    var next = cost + distance * (preferIndoor && !indoor ? OutdoorCostMultiplier : 1);
                    if (dist.TryGetValue(neighbor, out var known) && next >= known) continue;
                    dist[neighbor] = next;
                    prev[neighbor] = current;
                    queue.Enqueue(neighbor, next);
                }
            }
            if (end == null) return new([], 0);
            var nodePath = new List<Node> { end };
            while (prev.TryGetValue(nodePath[^1], out var parent)) nodePath.Add(parent);
            nodePath.Reverse();
            var path = new List<Coordinate>();
            foreach (var node in nodePath)
                if (path.Count == 0 || !path[^1].Equals2D(node.Position)) path.Add(node.Position);
            // Only named buildings stop at their edge. Markers always retain exact coordinates.
            var accessPath = path.ToList();
            if (startName != null && startBuilding != null) TrimBuilding(path, startBuilding, true);
            if (endName != null && endBuilding != null) TrimBuilding(path, endBuilding, false);
            // Adjacent buildings share an edge, so trimming both ends can collapse
            // an indoor doorway crossing to a single point. Keep its access nodes
            // to give named-building requests a visible route through the doorway.
            if (path.Count < 2 && accessPath.Count >= 2) path = accessPath;
            return new(path.Select(c => new[] { c.Y, c.X }).ToList(), dist[end]);
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
