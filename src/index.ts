type assignValues = [{ name: string; value: string }?];
let variables: assignValues = [];

export default {
	async fetch(request: Request, env: Env, ctx): Promise<Response> {
		ctx.passThroughOnException();
		if (env.localtest) {
			const req = new Request(env.localtest, request);
			console.log(env.localtest);
			return fetchAndStream(req, env);
		}
		return fetchAndStream(request, env);
	},
} satisfies ExportedHandler<Env>;

async function fetchAndStream(request: Request, env: Env): Promise<Response> {
	const response = await fetch(request);
	let contentType = response.headers.get('content-type');

	if (!contentType || !contentType.startsWith('text/')) {
		console.log('wrong contentType:', contentType);
		return new Response(response.body as BodyInit, response);
	}

	if (env.assign) {
		console.log('assign mode: enabled');
		const url = new URL(request.url);
		variables.push({ name: 'REQUEST_PATH', value: '"' + url.pathname + '"' });
		variables.push({ name: 'QUERY_STRING', value: '"' + url.searchParams.toString() + '"' });
	}

	let { readable, writable } = new TransformStream();
	let newResponse = new Response(readable, response);
	newResponse.headers.set('cache-control', 'max-age=0');
	streamTransformBody(request, env, response.body! as ReadableStream<any>, writable);
	return newResponse;
}

// FUNCTION: stream processing
async function streamTransformBody(request: Request, env: Env, readable: ReadableStream<any>, writable: WritableStream<any>) {
	const startTag = '<'.charCodeAt(0);
	const endTag = '>'.charCodeAt(0);
	let reader = readable.getReader();
	let writer = writable.getWriter();

	let templateChunks: ArrayBuffer[] | null = null;

	while (true) {
		let { done, value } = await reader.read();
		if (done) break;
		while (value.byteLength > 0) {
			if (templateChunks) {
				let end = value.indexOf(endTag);
				if (end === -1) {
					templateChunks.push(value);
					break;
				} else {
					templateChunks.push(value.subarray(0, end));
					await writer.write(await translate(request, env, templateChunks));
					templateChunks = null;
					value = value.subarray(end + 1);
				}
			}
			let start = value.indexOf(startTag);
			if (start === -1) {
				await writer.write(value);
				break;
			} else {
				await writer.write(value.subarray(0, start));
				value = value.subarray(start + 1);
				templateChunks = [];
			}
		}
	}
	await writer.close();
}

// FUNCTION: Decode stream buffer
async function translate(request: Request, env: Env, chunks: ArrayBuffer[]) {
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();

	// regex
	const assignRegex = /(esi:assign\s+?(?:name="(?<name>.*?)")\s+?(?:value="(?<value>.*?)").*)/gm;
	const includeRegex = /(esi:include\s+?(?:src="(?<src>.*?)").*)/gm;
	const esiTag = ['esi:'.charCodeAt(0), 'esi:'.charCodeAt(1), 'esi:'.charCodeAt(2), 'esi:'.charCodeAt(3)];

	let templateKey: string = chunks.reduce(
		(accumulator: string, chunk: ArrayBuffer) => accumulator + decoder.decode(chunk, { stream: true }),
		''
	);
	templateKey += decoder.decode();

	// check if templateKey is valid (esiTag)
	for (let i = 0; i < esiTag.length; i++) {
		if (templateKey.charCodeAt(i) !== esiTag[i]) {
			return encoder.encode(`<${templateKey}>`);
		}
	}

	if (env.localtest || env.debug) {
		console.log('templateKey:', templateKey);
	}

	// TODO add more esi syntax(keyword) here
	// handle esi:assign
	if (env.assign) {
		templateKey = await handleVariables(request, env, templateKey);
		const assignResult = assignRegex.exec(templateKey);
		if (assignResult) {
			if (env.localtest || env.debug) {
				console.log('assignResult:', assignResult[0]);
			}
			await handleAssign(request, env, assignResult);
			return encoder.encode(`<${templateKey}>`);
		}
	}

	// handle esi:include
	const includeResult = includeRegex.exec(templateKey);
	if (includeResult) {
		if (env.localtest || env.debug) {
			console.log('includeResult:', includeResult[0]);
		}
		return handleTemplate(request, env, encoder, templateKey, includeResult);
	}

	return encoder.encode(`<${templateKey}>`);
}

// FUNCTION: handle variable replace
async function handleVariables(request: Request, env: Env, esiTagContent: string) {
	// ESI Assign - variable replace
	if (variables.length > 0) {
		variables.map((variable) => {
			if (variable) {
				console.log('replacing:', esiTagContent, '$(' + variable.name + ')');
				esiTagContent = esiTagContent.replace('$(' + variable.name + ')', variable.value);
				console.log('esiTagContent:', esiTagContent);
			}
		});
	}
	return esiTagContent;
	//
}

// FUNCTION: handle variable table update
async function handleAssign(request: Request, env: Env, assignResult: any) {
	if (assignResult && assignResult.groups && assignResult.groups.name && assignResult.groups.value) {
		if (env.localtest || env.debug) {
			console.log('assignResult:', assignResult);
		}
		const { name, value } = assignResult.groups;
		if (variables.find((variable) => variable?.name === name)) {
			console.log('variable already exists, skipping:', { name, value });
		} else {
			variables.push({ name, value });
			if (env.localtest || env.debug) {
				console.log('variable updated:', variables);
			}
		}
	}
	//
}

// FUNCTION: esi:include handler
async function handleTemplate(request: Request, env: Env, encoder: TextEncoder, replacedContent: string, includeResult: RegExpExecArray) {
	const methodRgex = /method="(?<method>.*?)"/gm;
	const entityRgex = /entity="(?<entity>.*?)"/gm;
	const altRgex = /alt="(?<alt>.*?)"/gm;
	const onerrorRgex = /onerror="(?<onerror>.*?)"/gm;
	const maxwaitRgex = /maxwait="(?<maxwait>.*?)"/gm;
	const ttlRgex = /ttl="(?<ttl>.*?)"/gm;

	let esi;
	if (!includeResult || !includeResult.groups || !includeResult.groups.src) {
		console.log('no match:', replacedContent);
		return encoder.encode(`<${replacedContent}>`);
	} else if (env.fixedURL) {
		// FixedURL handling/ FixedURL handling
		esi = await subRequests(request, env, env.fixedURL);
		return encoder.encode(`${esi}`);
	} else {
		if (env.localtest || env.debug) {
			console.log('includeResult.groups:', includeResult.groups);
		}
		const { src } = includeResult.groups;
		const { method } = methodRgex.exec(replacedContent)?.groups || {};
		const { entity } = entityRgex.exec(replacedContent)?.groups || {};
		const { alt } = altRgex.exec(replacedContent)?.groups || {};
		const { onerror } = onerrorRgex.exec(replacedContent)?.groups || {};
		const { maxwait } = maxwaitRgex.exec(replacedContent)?.groups || {};
		const { ttl } = ttlRgex.exec(replacedContent)?.groups || {};
		const removeRegex = /[',"]/g;

		if (env.localtest || env.debug) {
			console.log('calling subrequest', {
				src: src,
				method: method,
				entity: entity,
				alt: alt,
				onerror: onerror,
				maxwait: maxwait,
				ttl: ttl,
			});
		}

		const target = src.replace(removeRegex, '');
		if (env.localtest || env.debug) {
			console.log('src:', src, 'target:', target);
		}

		esi = await subRequests(request, env, target);

		return encoder.encode(`${esi}`);
	}
	//
}
// FUNCTION: handle fetching
async function subRequests(request: Request, env: Env, target: string): Promise<string> {
	const init = {
		method: 'GET',
		headers: {
			'user-agent': 'cloudflare',
		},
	};
	if (env.localtest || env.debug) {
		console.log('target', target);
	}

	const response = await fetch(target, init);
	const text = await response.text();
	return text;
}
