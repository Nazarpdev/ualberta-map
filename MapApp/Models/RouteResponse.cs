namespace MapApp.Models;

/// <summary>Detailed route payload; echoes <see cref="PreferIndoor"/> so clients can detect stale servers.</summary>
public sealed record RouteResponse(List<double[]> Coordinates, double Cost, bool PreferIndoor);
