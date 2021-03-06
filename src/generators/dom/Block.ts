import CodeBuilder from '../../utils/CodeBuilder';
import deindent from '../../utils/deindent';
import { DomGenerator } from './index';
import { Node } from '../../interfaces';

export interface BlockOptions {
	name: string;
	generator?: DomGenerator;
	expression?: Node;
	context?: string;
	key?: string;
	contexts?: Map<string, string>;
	indexes?: Map<string, string>;
	contextDependencies?: Map<string, string[]>;
	params?: string[];
	indexNames?: Map<string, string>;
	listNames?: Map<string, string>;
	indexName?: string;
	listName?: string;
	dependencies?: Set<string>;
}

export default class Block {
	generator: DomGenerator;
	name: string;
	expression: Node;
	context: string;

	key: string;
	first: string;

	contexts: Map<string, string>;
	indexes: Map<string, string>;
	contextDependencies: Map<string, string[]>;
	dependencies: Set<string>;
	params: string[];
	indexNames: Map<string, string>;
	listNames: Map<string, string>;
	indexName: string;
	listName: string;

	builders: {
		create: CodeBuilder;
		mount: CodeBuilder;
		intro: CodeBuilder;
		update: CodeBuilder;
		outro: CodeBuilder;
		unmount: CodeBuilder;
		detachRaw: CodeBuilder;
		destroy: CodeBuilder;
	};

	hasIntroMethod: boolean;
	hasOutroMethod: boolean;
	outros: number;

	aliases: Map<string, string>;
	variables: Map<string, string>;
	getUniqueName: (name: string) => string;

	component: string;
	target: string;

	hasUpdateMethod: boolean;
	autofocus: string;

	constructor(options: BlockOptions) {
		this.generator = options.generator;
		this.name = options.name;
		this.expression = options.expression;
		this.context = options.context;

		// for keyed each blocks
		this.key = options.key;
		this.first = null;

		this.contexts = options.contexts;
		this.indexes = options.indexes;
		this.contextDependencies = options.contextDependencies;
		this.dependencies = new Set();

		this.params = options.params;
		this.indexNames = options.indexNames;
		this.listNames = options.listNames;

		this.listName = options.listName;

		this.builders = {
			create: new CodeBuilder(),
			mount: new CodeBuilder(),
			intro: new CodeBuilder(),
			update: new CodeBuilder(),
			outro: new CodeBuilder(),
			unmount: new CodeBuilder(),
			detachRaw: new CodeBuilder(),
			destroy: new CodeBuilder(),
		};

		this.hasIntroMethod = false; // a block could have an intro method but not intro transitions, e.g. if a sibling block has intros
		this.hasOutroMethod = false;
		this.outros = 0;

		this.aliases = new Map();
		this.variables = new Map();
		this.getUniqueName = this.generator.getUniqueNameMaker(options.params);

		// unique names
		this.component = this.getUniqueName('component');
		this.target = this.getUniqueName('target');

		this.hasUpdateMethod = false; // determined later
	}

	addDependencies(dependencies) {
		dependencies.forEach(dependency => {
			this.dependencies.add(dependency);
		});
	}

	addElement(
		name: string,
		renderStatement: string,
		parentNode: string,
		needsIdentifier = false
	) {
		const isToplevel = !parentNode;
		if (needsIdentifier || isToplevel) {
			this.builders.create.addLine(`var ${name} = ${renderStatement};`);

			this.mount(name, parentNode);
		} else {
			this.builders.create.addLine(
				`${this.generator.helper(
					'appendNode'
				)}( ${renderStatement}, ${parentNode} );`
			);
		}

		if (isToplevel) {
			this.builders.unmount.addLine(
				`${this.generator.helper('detachNode')}( ${name} );`
			);
		}
	}

	addVariable(name: string, init?: string) {
		if (this.variables.has(name) && this.variables.get(name) !== init) {
			throw new Error(
				`Variable '${name}' already initialised with a different value`
			);
		}

		this.variables.set(name, init);
	}

	alias(name: string) {
		if (!this.aliases.has(name)) {
			this.aliases.set(name, this.getUniqueName(name));
		}

		return this.aliases.get(name);
	}

	child(options: BlockOptions) {
		return new Block(Object.assign({}, this, options, { parent: this }));
	}

	contextualise(expression: Node, context?: string, isEventHandler?: boolean) {
		return this.generator.contextualise(
			this,
			expression,
			context,
			isEventHandler
		);
	}

	findDependencies(expression: Node) {
		return this.generator.findDependencies(
			this.contextDependencies,
			this.indexes,
			expression
		);
	}

	mount(name: string, parentNode: string) {
		if (parentNode) {
			this.builders.create.addLine(
				`${this.generator.helper('appendNode')}( ${name}, ${parentNode} );`
			);
		} else {
			this.builders.mount.addLine(
				`${this.generator.helper('insertNode')}( ${name}, ${this
					.target}, anchor );`
			);
		}
	}

	render() {
		let introing;
		const hasIntros = !this.builders.intro.isEmpty();
		if (hasIntros) {
			introing = this.getUniqueName('introing');
			this.addVariable(introing);
		}

		let outroing;
		const hasOutros = !this.builders.outro.isEmpty();
		if (hasOutros) {
			outroing = this.getUniqueName('outroing');
			this.addVariable(outroing);
		}

		if (this.variables.size) {
			const variables = Array.from(this.variables.keys())
				.map(key => {
					const init = this.variables.get(key);
					return init !== undefined ? `${key} = ${init}` : key;
				})
				.join(', ');

			this.builders.create.addBlockAtStart(`var ${variables};`);
		}

		if (this.autofocus) {
			this.builders.create.addLine(`${this.autofocus}.focus();`);
		}

		// minor hack – we need to ensure that any {{{triples}}} are detached first
		this.builders.unmount.addBlockAtStart(this.builders.detachRaw);

		const properties = new CodeBuilder();

		let localKey;
		if (this.key) {
			localKey = this.getUniqueName('key');
			properties.addBlock(`key: ${localKey},`);
		}

		if (this.first) {
			properties.addBlock(`first: ${this.first},`);
		}

		if (this.builders.mount.isEmpty()) {
			properties.addBlock(`mount: ${this.generator.helper('noop')},`);
		} else {
			properties.addBlock(deindent`
				mount: function ( ${this.target}, anchor ) {
					${this.builders.mount}
				},
			`);
		}

		if (this.hasUpdateMethod) {
			if (this.builders.update.isEmpty()) {
				properties.addBlock(`update: ${this.generator.helper('noop')},`);
			} else {
				properties.addBlock(deindent`
					update: function ( changed, ${this.params.join(', ')} ) {
						${this.builders.update}
					},
				`);
			}
		}

		if (this.hasIntroMethod) {
			if (hasIntros) {
				properties.addBlock(deindent`
					intro: function ( ${this.target}, anchor ) {
						if ( ${introing} ) return;
						${introing} = true;
						${hasOutros && `${outroing} = false;`}

						${this.builders.intro}

						this.mount( ${this.target}, anchor );
					},
				`);
			} else {
				properties.addBlock(deindent`
					intro: function ( ${this.target}, anchor ) {
						this.mount( ${this.target}, anchor );
					},
				`);
			}
		}

		if (this.hasOutroMethod) {
			if (hasOutros) {
				properties.addBlock(deindent`
					outro: function ( ${this.alias('outrocallback')} ) {
						if ( ${outroing} ) return;
						${outroing} = true;
						${hasIntros && `${introing} = false;`}

						var ${this.alias('outros')} = ${this.outros};

						${this.builders.outro}
					},
				`);
			} else {
				properties.addBlock(deindent`
					outro: function ( outrocallback ) {
						outrocallback();
					},
				`);
			}
		}

		if (this.builders.unmount.isEmpty()) {
			properties.addBlock(`unmount: ${this.generator.helper('noop')},`);
		} else {
			properties.addBlock(deindent`
				unmount: function () {
					${this.builders.unmount}
				},
			`);
		}

		if (this.builders.destroy.isEmpty()) {
			properties.addBlock(`destroy: ${this.generator.helper('noop')}`);
		} else {
			properties.addBlock(deindent`
				destroy: function () {
					${this.builders.destroy}
				}
			`);
		}

		return deindent`
			function ${this.name} ( ${this.params.join(', ')}, ${this.component}${this
			.key
			? `, ${localKey}`
			: ''} ) {
				${this.builders.create}

				return {
					${properties}
				};
			}
		`;
	}
}
