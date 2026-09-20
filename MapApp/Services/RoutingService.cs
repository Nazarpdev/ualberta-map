using NetTopologySuite.Features;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;

namespace MapApp.Services
{
    public class RoutingService
    {
        private readonly Dictionary<Coordinate, List<(Coordinate neighbor, double distance)>> _graph = new();
        private readonly HashSet<Coordinate> _pedestrian = new();
        private readonly List<Geometry> _buildings = new();

        // Ways a pedestrian can actually walk on. Excludes roads (service, residential,
        // secondary, ...) so building destinations snap to a door/pedway node, not the road outside.
        private static readonly HashSet<string> PedestrianHighways = new(StringComparer.OrdinalIgnoreCase)
        {
            "footway", "path", "pedestrian", "steps", "cycleway"
        };

        // Pedway/sidewalk nodes sit a hair outside the building polygon they serve. Treat a node
        // within this distance (degrees, ~1 m) as being at the building's edge.
        private const double EdgeSnapTolerance = 0.00001;

        public RoutingService()
        {
            var geoJson = File.ReadAllText("wwwroot/map.geojson");
            var reader = new GeoJsonReader();
            var features = reader.Read<FeatureCollection>(geoJson);

            foreach (var feature in features)
            {
                if (feature.Geometry is LineString line)
                {
                    var coords = line.Coordinates;
                    for (int i = 0; i < coords.Length - 1; i++)
                    {
                        AddEdge(coords[i], coords[i + 1]);
                        AddEdge(coords[i + 1], coords[i]);
                    }

                    var highway = feature.Attributes?.GetNames().Contains("highway") == true
                        ? feature.Attributes["highway"]?.ToString()
                        : null;
                    if (highway != null && PedestrianHighways.Contains(highway))
                    {
                        foreach (var c in coords) _pedestrian.Add(c);
                    }
                }
                else if (feature.Geometry is Polygon or MultiPolygon
                         && feature.Attributes?.GetNames().Contains("building") == true)
                {
                    _buildings.Add(feature.Geometry);
                }
            }
        }

        private bool IsIndoor(double lat, double lon)
            => _buildings.Any(b => b.Contains(new Point(lon, lat)));

        // When a route's end node is inside a building, terminate the drawn line at the
        // building's boundary along the line of approach ("edge to edge") instead of at an
        // interior node such as the entrance. Keying off the route node (not the requested
        // point) is robust for L-shaped buildings whose centroid lies outside the polygon.
        private void ConnectToBuildingEdge(List<double[]> path, bool fromStart)
        {
            int n = path.Count;
            var tip = path[fromStart ? 0 : n - 1];

            var building = _buildings.FirstOrDefault(b => b.Contains(new Point(tip[1], tip[0])));
            if (building == null) return; // end node is outdoors: keep nearest-entrance behaviour

            int outer = -1; // node closest to this end that is still outside the building
            if (fromStart)
            {
                for (int i = 0; i < n; i++)
                    if (!building.Contains(new Point(path[i][1], path[i][0]))) { outer = i; break; }
            }
            else
            {
                for (int i = n - 1; i >= 0; i--)
                    if (!building.Contains(new Point(path[i][1], path[i][0]))) { outer = i; break; }
            }
            if (outer < 0) return; // whole route is inside the building; leave it as-is

            // tip is strictly inside, so the first outside node always has a neighbour behind it
            var outNode = path[outer];
            var inNode = fromStart ? path[outer - 1] : path[outer + 1];

            var seg = new LineString(new[]
            {
                new Coordinate(outNode[1], outNode[0]),
                new Coordinate(inNode[1], inNode[0])
            });

            var crossed = building.Intersection(seg);
            if (crossed.IsEmpty) return;

            // the boundary point where the route enters/leaves the building
            var edge = crossed.Coordinates
                .OrderBy(c => c.Distance(new Coordinate(outNode[1], outNode[0])))
                .First();

            if (fromStart)
            {
                path.RemoveRange(0, outer);
                path.Insert(0, [edge.Y, edge.X]);
            }
            else
            {
                path.RemoveRange(outer + 1, path.Count - 1 - outer);
                path.Add([edge.Y, edge.X]);
            }
        }

        // The requested destination is inside a building ("walking on the inside"), but the
        // route's end node is merely the nearest walkable node to it -- often an entrance on the
        // far side of the building. Walk the route from the start and stop the drawn line where it
        // first reaches the destination building's edge, instead of running along the outside to
        // that entrance.
        private void TerminateEndAtBuildingEdge(List<double[]> path, double elat, double elon)
        {
            int n = path.Count;
            if (n == 0) return;

            var dest = _buildings.FirstOrDefault(b => b.Covers(new Point(elon, elat)));
            if (dest == null)
            {
                // Requested point is outdoors (e.g. the centroid of an L-shaped building lies
                // outside its polygon): fall back to keying off the route's end node, which is
                // typically an entrance on that building's boundary.
                var tip = path[n - 1];
                dest = _buildings.FirstOrDefault(b => b.Covers(new Point(tip[1], tip[0])));
            }
            if (dest == null) return; // destination is outdoors: keep nearest-entrance behaviour

            for (int i = 0; i < n; i++)
            {
                var node = path[i];
                if (dest.Distance(new Point(node[1], node[0])) > EdgeSnapTolerance)
                    continue;

                // Reached the building. A strictly interior node is pulled back to the boundary
                // along the line of approach ("edge to edge"); a node on or just outside the wall
                // (e.g. a pedway landing) is already at the edge and is kept as the end.
                if (i > 0 && dest.Contains(new Point(node[1], node[0])))
                {
                    var prev = path[i - 1];
                    var crossed = dest.Intersection(new LineString(new[]
                    {
                        new Coordinate(prev[1], prev[0]),
                        new Coordinate(node[1], node[0])
                    }));
                    if (!crossed.IsEmpty)
                    {
                        var edge = crossed.Coordinates
                            .OrderBy(c => c.Distance(new Coordinate(prev[1], prev[0])))
                            .First();
                        path.RemoveRange(i, path.Count - i);
                        path.Add([edge.Y, edge.X]);
                        return;
                    }
                }

                path.RemoveRange(i + 1, path.Count - (i + 1));
                return;
            }
        }

        private void AddEdge(Coordinate a, Coordinate b)
        {
            if (!_graph.TryGetValue(a, out List<(Coordinate neighbor, double distance)>? value))
            {
                value = [];
                _graph[a] = value;
            }
            value.Add((b, a.Distance(b)));
        }

        private Coordinate Nearest(double lat, double lon)
        {
            var target = new Coordinate(lon, lat);
            return _pedestrian.MinBy(k => k.Distance(target))!;
        }

        public List<double[]> GetRoute(double slat, double slon, double elat, double elon)
        {
            var start = Nearest(slat, slon);
            var end = Nearest(elat, elon);

            var dist = new Dictionary<Coordinate, double>();
            var prev = new Dictionary<Coordinate, Coordinate>();
            var pq = new PriorityQueue<Coordinate, double>();

            foreach (var node in _graph.Keys) dist[node] = double.MaxValue;
            dist[start] = 0;
            pq.Enqueue(start, 0);

            while (pq.Count > 0)
            {
                var curr = pq.Dequeue();
                if (curr.Equals(end)) break;

                foreach (var (neighbor, distance) in _graph[curr])
                {
                    var alt = dist[curr] + distance;
                    if (alt < dist[neighbor])
                    {
                        dist[neighbor] = alt;
                        prev[neighbor] = curr;
                        pq.Enqueue(neighbor, alt);
                    }
                }
            }

            var path = new List<double[]>();
            var c = end;
            while (prev.ContainsKey(c))
            {
                path.Add([c.Y, c.X]);
                c = prev[c];
            }
            if (path.Count > 0) path.Add([start.Y, start.X]);
            path.Reverse();

            // Connect "edge to edge": when an endpoint is inside a building, the drawn line
            // stops at the building boundary along the approach, rather than at an interior
            // point (e.g. the centroid) which may be outside an L-shaped building.
            if (path.Count > 0)
            {
                ConnectToBuildingEdge(path, fromStart: true);
                TerminateEndAtBuildingEdge(path, elat, elon);
            }

            return path;
        }

        public Dictionary<string, double[]> GetLocations()
            {
                var locs = new Dictionary<string, double[]>();
                var geoJson = File.ReadAllText("wwwroot/map.geojson");
                var reader = new GeoJsonReader();
                var features = reader.Read<FeatureCollection>(geoJson);

                foreach (var f in features)
                {
                    if (f.Attributes != null && f.Attributes.GetNames().Contains("name"))
                    {
                        var name = f.Attributes["name"].ToString();
                        if (name != null)
                        {
                            var center = f.Geometry.Centroid;
                            locs[name] = [center.Y, center.X];
                        }
                    }
                }
                return locs;
            }
    }
}
