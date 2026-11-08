namespace MapApp.Models;

/// <summary>A computed route as <c>[lat, lon]</c> pairs and its weighted cost in metres.</summary>
public sealed record RouteDetails(List<double[]> Coordinates, double Cost)
{
    public static RouteDetails Empty { get; } = new([], 0);
}
