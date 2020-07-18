import path from 'path';

import {terser} from 'rollup-plugin-terser';
import analyze from 'rollup-plugin-analyzer';
import cleanup from 'rollup-plugin-cleanup';
import commonjs from 'rollup-plugin-commonjs';
import resolve from 'rollup-plugin-node-resolve';
import svelte from 'rollup-plugin-svelte';

import * as _ from 'lamb';

import pkg from './package.json';

const renameToExtension = ext => filepath => {
	const split = filepath.split('.');
	const oldExt = `.${split[split.length - 1]}`;

	return filepath.replace(oldExt, ext);
}
const makeBanner = pkg => {
	const author = typeof pkg.author === 'object'
		? pkg.author.name
		: pkg.author;
	const year = new Date().getFullYear();

	return `// ${pkg.name} v${pkg.version} - © ${year} ${author}`
}

const renameToMinJs = renameToExtension('.min.js');
const banner = makeBanner(pkg);
const analyzer = analyze({
	limit: 15,
	root: path.resolve('../../../'),
	stdout: true,
	summaryOnly: true
});
const dir = 'dist';
const external = pkg.peerDependencies && Object.keys(pkg.peerDependencies) || [];
const input = {
	BarchartV: 'src/BarchartVDiv.svelte',
	index: 'src/index.js',
};
const treeshake = {
	annotations: true,
	moduleSideEffects: id =>
		// prevent from unadvertantly setting to false no matter what we install
		!(/@svizzle\/dom/gu).test(id) ||
		!(/@svizzle\/utils/gu).test(id) ||
		!(/just-compare/gu).test(id) ||
		!(/lamb/gu).test(id)
}

const cjsConfig = {
	external,
	input,
	output: {
		banner,
		dir,
		format: 'cjs',
		indent: false
	},
	plugins: [
		resolve(),
		commonjs(),
		svelte(),
		cleanup(),
	],
	treeshake
};

const makeConfig = _.pipe([
	_.mapValuesWith((value, name) => ({
		external,
		input: value,
		output: {
			banner,
			file: `${dir}/${name}.browser.js`,
			format: 'umd',
			name: `${pkg.name}/${name}`,
			indent: false
		},
		plugins: [
			resolve(),
			commonjs(),
			svelte(),
			cleanup(),
			// json(),
			// buble({
			//	 transforms: { dangerousForOf: true }
			// }),
		],
		treeshake
	})),
	_.values
]);

const browserConfig = makeConfig(input);
const browserMinifiedConfig = browserConfig.map(obj => ({
	...obj,
	output: {
		...obj.output,
		file: renameToMinJs(obj.output.file)
	},
	plugins: [
		...obj.plugins,
		terser({
			output: {
				preamble: obj.output.banner
			}
		}),
		analyzer
	],
	treeshake
}));

export default [
	...browserConfig,
	...browserMinifiedConfig,
	cjsConfig
];
