# ESI Workers

This project is a Cloudflare Workers application that processes incoming HTTP requests, performs HTML rewriting, and handles variable replacements in the response.

## Features

- Fetches and processes incoming HTTP requests.
- Rewrites HTML content using `HTMLRewriter`.
- Replaces variables in the response content based on predefined mappings.

## Installation

1. Clone the repository:

```sh
git clone https://github.com/cf-jongsik/esi-workers.git
cd esi-workers
```

2. Install dependencies:

```sh
npm install
```

## Usage

To start the development server, run:

```sh
npm run dev
```

To build the project for production, run:

```sh
npm run build
```

## Deployment

To deploy the project to Cloudflare Workers, run:

```sh
npm run deploy
```
