This workers script will stay between request and response as a workers-routes.
<br/>
The script will check for "<ESI:include>" HTML tag from the origin response then replace it with the fetched body according to the ESI tag.
<br/>
This is just a Typescript version of original Javascript from here.
<br/>
https://blog.cloudflare.com/edge-side-includes-with-cloudflare-workers
<br/>
<br/>

```sh
1. after git clone
2. rename wrangler.toml.example to wrangler.toml
3. uncomment route and change it to fit your use
4. deploy with wrangler
DONE
```
