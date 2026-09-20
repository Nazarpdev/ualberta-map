using MapApp.Services;
using Microsoft.AspNetCore.StaticFiles;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<RoutingService>();

var app = builder.Build();

app.UseDefaultFiles();
var contentTypes = new FileExtensionContentTypeProvider();
contentTypes.Mappings[".geojson"] = "application/geo+json";
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = contentTypes });

app.MapGet("/api/route", (double slat, double slon, double elat, double elon, RoutingService rs,
    string? startName = null, string? endName = null, bool avoidSub = false) =>
    rs.GetRoute(slat, slon, elat, elon, startName, endName, avoidSub));
app.MapGet("/api/locations", (RoutingService rs) => rs.GetLocations());

app.Run();
