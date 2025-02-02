const variables: Record<string, string> = {};

class ElementHandler {
	async element(element: Element) {
		if (!element.tagName.startsWith('esi:')) {
			return;
		}
		const command = element.tagName.split(':')[1];
		if (!command) {
			return;
		}
		switch (command) {
			case 'include':
				const src = element.getAttribute('src');
				if (!src) return;
				const updatedSrc = replaceVariable(src);
				if (!updatedSrc) return;
				const res = await fetch(updatedSrc);
				if (!res) {
					return;
				}
				const text = await res.text();
				element.replace(text, { html: true });
				break;
			case 'assign':
				const key = element.getAttribute('name');
				const value = element.getAttribute('value');
				if (!key || !value) return;
				const updatedValue = replaceVariable(value);
				if (!updatedValue) return;
				variables[key] = updatedValue;
				element.setAttribute('value', updatedValue);
				break;
			default:
				return;
		}
		return;
	}

	comments(comment: Comment) {
		// An incoming comment
	}

	text(text: Text) {
		// An incoming piece of text
	}
}

const replaceVariable = (src: string): string => {
	const regex = /\$\{(.*?)\}/g;
	const regexResult = src.match(regex);
	if (!regexResult) {
		return src;
	}
	let result = src;
	regexResult.forEach((matched: string) => {
		const key = matched.substring(2, matched.length - 1);
		const value = variables[key];
		if (!value) {
			return;
		}
		result = result.replaceAll(matched, value);
	});
	return result;
};

async function handleRequest(req: Request): Promise<Response> {
	try {
		const res = await fetch(req);
		return new HTMLRewriter().on('*', new ElementHandler()).transform(res);
	} catch (error) {
		console.error('Error handling request:', error);
		return fetch(req);
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		ctx.passThroughOnException();
		return handleRequest(request);
	},
} satisfies ExportedHandler<Env>;
