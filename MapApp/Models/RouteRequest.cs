using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace MapApp.Models;

/// <summary>Query parameters accepted by <c>GET /api/route</c>.</summary>
public sealed class RouteRequest
{
    [BindRequired] public double Slat { get; init; }
    [BindRequired] public double Slon { get; init; }
    [BindRequired] public double Elat { get; init; }
    [BindRequired] public double Elon { get; init; }

    /// <summary>Named start building; routes stop at its edge instead of the exact marker.</summary>
    public string? StartName { get; init; }

    /// <summary>Named end building; routes stop at its edge instead of the exact marker.</summary>
    public string? EndName { get; init; }

    /// <summary>Exclude edges through the Students' Union Building (used for indoor SUB handoffs).</summary>
    public bool AvoidSub { get; init; }

    /// <summary>Penalise outdoor edges so covered routes are preferred.</summary>
    public bool PreferIndoor { get; init; }

    /// <summary>Return a <see cref="RouteResponse"/> instead of a bare coordinate list.</summary>
    public bool IncludeCost { get; init; }
}
