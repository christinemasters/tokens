// Sends every www address to the same address without www.
// GitHub Pages did this for the site before the move to Cloudflare.

const HOME = "allthetokenswehaveleft.com";

export default {
  fetch(request) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.hostname = HOME;
    url.port = "";
    return Response.redirect(url.toString(), 301);
  },
};
