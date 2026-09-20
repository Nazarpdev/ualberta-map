using System.Text.Json;
using MapApp.Services;

static void Check(bool condition, string message)
{
    if (!condition) throw new Exception(message);
    Console.WriteLine($"PASS: {message}");
}
static bool At(double[] p, double lat, double lon)
    => Math.Abs(p[0] - lat) < 1e-10 && Math.Abs(p[1] - lon) < 1e-10;

var features = new List<object>();
void Feature(string type, object coordinates, Dictionary<string, string> properties)
    => features.Add(new { type = "Feature", geometry = new { type, coordinates }, properties });
void Building(string name, double x)
    => Feature("Polygon", new[] { new[] {
        new[] { x, 0.0 }, new[] { x + .001, 0.0 }, new[] { x + .001, .001 },
        new[] { x, .001 }, new[] { x, 0.0 } } }, new() { ["building"] = "yes", ["name"] = name });
void Way(double[][] points, bool bridge = false)
    => Feature("LineString", points, bridge
        ? new() { ["highway"] = "footway", ["bridge"] = "yes" }
        : new() { ["highway"] = "footway" });
Building("A", 0);
Building("B", .002);
Building("Disconnected", .01);
Feature("Point", new[] { 0.0, .0002 }, new() { ["entrance"] = "yes" });
Feature("Point", new[] { .003, .0002 }, new() { ["entrance"] = "yes" });
Way([[0, .0002], [-.001, .0002]]);
Way([[.001, .0008], [.002, .0008]], true);
Way([[.003, .0002], [.004, .0002]]);

var file = Path.Combine(Path.GetTempPath(), $"routing-check-{Guid.NewGuid()}.geojson");
try
{
    File.WriteAllText(file, JsonSerializer.Serialize(new { type = "FeatureCollection", features }));
    var service = new RoutingService(file);
    var named = service.GetRoute(.0005, .0005, .0005, .0025, "A", "B");
    Check(named.Count == 2 && At(named[0], .0008, .001) && At(named[^1], .0008, .002),
        "Typed buildings connect at pedway edges, not outside doors");
    var markers = service.GetRoute(.0007, .0005, .0007, .0025);
    Check(markers.Count > 2 && At(markers[0], .0007, .0005) && At(markers[^1], .0007, .0025),
        "Indoor markers keep exact endpoints");
    Check(markers.All(p => p[0] >= .0007), "Indoor route avoids outside-door detours");
    var outside = service.GetRoute(.0007, .0005, .0003, -.0005);
    Check(outside.Any(p => At(p, .0002, 0)) && At(outside[^1], .0003, -.0005),
        "Exiting to outdoors uses the mapped door and reaches the marker");
    var entering = service.GetRoute(.0003, -.0005, .0007, .0005);
    Check(entering.Any(p => At(p, .0002, 0)) && At(entering[^1], .0007, .0005),
        "Arriving from outdoors uses the door then reaches the indoor marker");
    var typedArrival = service.GetRoute(.0003, -.0005, .0005, .0005, endName: "A");
    Check(At(typedArrival[^1], .0002, 0), "Typed destination reached outdoors ends at its door");
    var same = service.GetRoute(.0004, .0004, .0006, .0006);
    Check(same.Count == 2 && At(same[0], .0004, .0004) && At(same[1], .0006, .0006),
        "Markers in the same building stay inside");
    var segment = service.GetRoute(.0003, -.0003, .0003, -.0007);
    Check(segment.Count == 4 && At(segment[1], .0002, -.0003) && At(segment[2], .0002, -.0007),
        "Outdoor markers join the path at projections, without vertex detours");
    Check(service.GetRoute(.0005, .0005, .0005, .0105, "A", "Disconnected").Count == 0,
        "Unconnected buildings do not invent an outside entrance");
    var repeated = service.GetRoute(.0005, .0005, .0005, .0025, "A", "B");
    Check(JsonSerializer.Serialize(named) == JsonSerializer.Serialize(repeated),
        "Marker requests do not mutate the shared routing graph");
}
finally { File.Delete(file); }

if (args.Length > 0)
{
    var campus = new RoutingService(args[0]);
    var locations = campus.GetLocations();
    var cab = locations["Central Academic Building"];
    var campusFeatures = new NetTopologySuite.IO.GeoJsonReader().Read<NetTopologySuite.Features.FeatureCollection>(File.ReadAllText(args[0]));
    var subBuildings = campusFeatures.Where(f => f.Attributes.Exists("building")
        && f.Attributes.Exists("name") && f.Attributes["name"]?.ToString() == "Students' Union Building")
        .Select(f => f.Geometry).ToList();
    foreach (var door in new[] { new[] { 53.525407, -113.5263 }, new[] { 53.525459, -113.526773 }, new[] { 53.525367, -113.527955 } })
    {
        var campusLeg = campus.GetRoute(cab[0], cab[1], door[0], door[1], avoidSub: true);
        Check(campusLeg.Count > 0 && At(campusLeg[^1], door[0], door[1]), "Campus leg reaches the selected SUB entrance");
        Check(campusLeg.Zip(campusLeg.Skip(1)).All(pair => !subBuildings.Any(building =>
            new NetTopologySuite.Geometries.LineString([
                new NetTopologySuite.Geometries.Coordinate(pair.First[1], pair.First[0]),
                new NetTopologySuite.Geometries.Coordinate(pair.Second[1], pair.Second[0])
            ]).Relate(building, "T********"))), "Campus leg cannot shortcut through SUB before the indoor handoff");
    }
    // CAB–SAB's pedway uses man_made=bridge rather than bridge=yes. Its
    // boundary nodes must be available directly, without visiting the west doors.
    var cabToSab = campus.GetRoute(53.52641, -113.52477, 53.52602, -113.52455);
    Check(cabToSab.Count > 0 && At(cabToSab[0], 53.52641, -113.52477)
        && At(cabToSab[^1], 53.52602, -113.52455), "CAB–SAB screenshot markers retain their positions");
    Check(!cabToSab.Any(p => At(p, 53.526702, -113.525057) || At(p, 53.52583, -113.524935)),
        "CAB–SAB indoor route never visits either outside door");
    Check(cabToSab.Count == 4 && At(cabToSab[1], 53.526307, -113.524778)
        && At(cabToSab[2], 53.52611, -113.524778), "CAB–SAB markers connect directly to the indoor pedway");
    var sab = locations["South Academic Building"];
    var namedSab = campus.GetRoute(cab[0], cab[1], sab[0], sab[1],
        "Central Academic Building", "South Academic Building");
    Check(namedSab.Count == 2 && namedSab.All(p => Math.Abs(p[1] + 113.524778) < 1e-10),
        "Typed CAB–SAB route only spans the pedway between building edges");
    foreach (var name in new[] { "Cameron Library", "Centennial Centre for Interdisciplinary Science" })
    {
        if (!locations.TryGetValue(name, out var destination)) throw new Exception($"Missing {name}");
        var route = campus.GetRoute(cab[0], cab[1], destination[0], destination[1]);
        Check(route.Count > 0 && At(route[0], cab[0], cab[1]) && At(route[^1], destination[0], destination[1]),
            $"Campus markers: CAB to {name} preserve exact endpoints");
        var typed = campus.GetRoute(cab[0], cab[1], destination[0], destination[1], "Central Academic Building", name);
        Check(typed.Count > 0 && !At(typed[0], cab[0], cab[1]) && !At(typed[^1], destination[0], destination[1]),
            $"Campus typed buildings: CAB to {name} end at access points");
    }
}
