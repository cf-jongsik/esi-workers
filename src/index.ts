import { env } from 'cloudflare:workers';
type Variables = Record<string, string>;

class ElementHandler {
	private regex = /\$\{(.*?)\}/g;
	private variables: Variables;
	private includeBody: ReadableStream<any> | null = null;
	private includeType: string | null = null;

	constructor(variables: Variables = Object.create(null)) {
		this.variables = variables;
	}

	private async handleInclude(element: Element): Promise<void> {
		if (env.DEBUG) console.debug('Processing include');

		const src = element.getAttribute('src');
		if (!src) {
			console.warn('Include missing src attribute');
			element.remove();
			return;
		}

		const updatedSrc = src.replace(this.regex, (_, key) => this.variables[key] ?? '');
		if (!updatedSrc) {
			console.warn('Could not determine include URL');
			element.remove();
			return;
		}

		if (env.DEBUG) console.debug('Fetching include from:', updatedSrc);
		try {
			const res = await fetch(updatedSrc, { redirect: 'follow' });
			if (!res || !res.ok || !res.body) {
				console.warn(`Failed to fetch include content: ${res?.status} ${res?.statusText}`);
				element.remove();
				return;
			}
			this.includeBody = res.body;
			this.includeType = res.headers.get('Content-Type') ?? null;
			element.remove();
		} catch (error) {
			console.error('Error fetching include:', error);
			element.remove();
		}
	}

	private handleAssign(element: Element): void {
		const key = element.getAttribute('name')?.replace(/["']/g, '');
		const value = element.getAttribute('value')?.replace(/["']/g, '');

		if (!key || !value) {
			console.warn('Assign missing required attributes');
			element.remove();
			return;
		}
		const updatedValue = value.replace(this.regex, (_, key) => this.variables[key] ?? '');
		this.variables[key] = updatedValue;

		if (env.DEBUG) console.debug('Variable assigned:', key, '=', updatedValue);
		element.remove();
	}
	async element(element: Element): Promise<void> {
		console.debug('Processing element:', element.tagName);
		if (this.includeBody) {
			if (this.includeType?.includes('text/html')) {
				element.before(this.includeBody, { html: true });
			}
			this.includeBody = null; // Reset after appending
		}
		// If not an ESI tag, no further processing needed
		if (!element.tagName.startsWith('esi:')) return;

		const command = element.tagName.split(':')[1];
		if (!command) return;

		switch (command) {
			case 'include':
				await this.handleInclude(element);
				break;
			case 'assign':
				this.handleAssign(element);
				break;
			default:
				if (env.DEBUG) console.debug('Unsupported ESI command:', command);
				element.remove();
		}
	}
}

async function handleRequest(req: Request, ctx: ExecutionContext): Promise<Response> {
	const cache = caches.default;
	let response: Response | undefined;
	const start = performance.now();
	try {
		// Attempt to get cached response
		response = (await cache.match(req)) ?? (await fetchAndCache(req, cache, ctx));
	} catch (error) {
		console.error('Error fetching or caching:', error);
		return fetch(req); // fallback to origin
	}
	// Only process HTML responses
	const contentType = response.headers.get('Content-Type') ?? '';
	if (!contentType.includes('text/html')) {
		if (env.DEBUG) console.debug('Skipping non-HTML content:', contentType);
		return response;
	}

	// Process the HTML with ESI tags
	const finalRes = new HTMLRewriter().on('*', new ElementHandler()).transform(response);
	const end = performance.now();
	if (env.DEBUG) console.debug(`Request processed in ${end - start} ms`);
	return finalRes;
}

async function fetchAndCache(req: Request, cache: Cache, ctx: ExecutionContext): Promise<Response> {
	const response = await fetch(req, { redirect: 'follow' });
	if (!response || !response.ok) {
		return new Response(response?.statusText || 'Not Found', { status: response?.status || 404 });
	}
	ctx.waitUntil(cache.put(req, response.clone()));
	return response;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (env.DEBUG && env.LOCALTEST) {
			if (!request.url.endsWith('/')) {
				return new Response('test mode', { status: 418 });
			}
			console.debug('Local test mode enabled');
			return handleRequest(new Request(env.LOCALTEST), ctx);
		}
		return handleRequest(request, ctx);
	},
} satisfies ExportedHandler<Env>;
