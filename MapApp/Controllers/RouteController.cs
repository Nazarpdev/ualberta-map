using MapApp.Models;
using MapApp.Services;
using Microsoft.AspNetCore.Mvc;

namespace MapApp.Controllers;

[ApiController]
[Route("api/route")]
public sealed class RouteController(IRoutingService routing) : ControllerBase
{
    [HttpGet]
    public IActionResult Get([FromQuery] RouteRequest request)
    {
        var route = routing.GetRouteDetails(request.Slat, request.Slon, request.Elat, request.Elon,
            request.StartName, request.EndName, request.AvoidSub, request.PreferIndoor);
        return request.IncludeCost
            ? Ok(new RouteResponse(route.Coordinates, route.Cost, request.PreferIndoor))
            : Ok(route.Coordinates);
    }
}
