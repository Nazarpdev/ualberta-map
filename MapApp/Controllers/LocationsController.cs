using MapApp.Services;
using Microsoft.AspNetCore.Mvc;

namespace MapApp.Controllers;

[ApiController]
[Route("api/locations")]
public sealed class LocationsController(IRoutingService routing) : ControllerBase
{
    [HttpGet]
    public ActionResult<Dictionary<string, double[]>> Get() => routing.GetLocations();
}
