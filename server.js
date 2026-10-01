const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 3000,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    const relative = new Map([
      ["/", "index.html"],
      ["/index.html", "index.html"],
      ["/app.js", "app.js"],
      ["/styles.css", "styles.css"],
    ]).get(pathname);
    if (!relative) return new Response("Not found", { status: 404 });
    const file = Bun.file(relative);
    return (await file.exists())
      ? new Response(file)
      : new Response("Not found", { status: 404 });
  },
});
console.log(`Squirrel Census is running at ${server.url}`);
