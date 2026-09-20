using MapApp.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<RoutingService>();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/route", (double slat, double slon, double elat, double elon, RoutingService rs) =>
    rs.GetRoute(slat, slon, elat, elon));
app.MapGet("/api/locations", (RoutingService rs) => rs.GetLocations());

app.Run();
