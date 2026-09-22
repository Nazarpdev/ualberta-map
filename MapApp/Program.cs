using MapApp.Services;
using Microsoft.AspNetCore.StaticFiles;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<RoutingService>();

var app = builder.Build();

app.UseDefaultFiles();
var contentTypes = new FileExtensionContentTypeProvider();
contentTypes.Mappings[".geojson"] = "application/geo+json";
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = contentTypes,
    OnPrepareResponse = context =>
    {
        // Revalidate the module graph as a unit after routing/UI updates.
        if (Path.GetExtension(context.File.Name) is ".html" or ".js" or ".mjs")
            context.Context.Response.Headers.CacheControl = "no-cache";
    }
});

app.MapGet("/api/route", (double slat, double slon, double elat, double elon, RoutingService rs,
    string? startName = null, string? endName = null, bool avoidSub = false, bool preferIndoor = false, bool includeCost = false) =>
{
    var route = rs.GetRouteDetails(slat, slon, elat, elon, startName, endName, avoidSub, preferIndoor);
    return includeCost ? Results.Ok(new { route.Coordinates, route.Cost, preferIndoor }) : Results.Ok(route.Coordinates);
});
app.MapGet("/api/locations", (RoutingService rs) => rs.GetLocations());

app.Run();
