using MapApp.Models;

namespace MapApp.Services;

public interface IRoutingService
{
    RouteDetails GetRouteDetails(double slat, double slon, double elat, double elon,
        string? startName = null, string? endName = null, bool avoidSub = false, bool preferIndoor = false,
        IReadOnlyCollection<string>? avoidBuildings = null);

    /// <summary>Named map locations keyed by name, as <c>[lat, lon]</c>.</summary>
    Dictionary<string, double[]> GetLocations();
}
