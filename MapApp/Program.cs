using MapApp.Services;
using Microsoft.AspNetCore.StaticFiles;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
// Resolve map data from the web root so the app works regardless of the working directory.
builder.Services.AddSingleton<IRoutingService>(services =>
{
    var webRoot = services.GetRequiredService<IWebHostEnvironment>().WebRootPath;
    return new RoutingService(
        Path.Combine(webRoot, "map.geojson"),
        Path.Combine(webRoot, "routing-overrides.geojson"));
});

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

app.MapControllers();

app.Run();
