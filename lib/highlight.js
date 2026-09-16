var NASHighlight = (() => {
	const ALIASES = {
		"c++": "cpp",
		"c#": "csharp",
		"f#": "fsharp",
		"objective-c": "objc",
		objective_c: "objc",
		"plain text": "plaintext",
		"visual basic": "vb",
		"vb.net": "vb",
		js: "javascript",
		node: "javascript",
		ts: "typescript",
		py: "python",
		sh: "bash",
		shell: "bash",
		zsh: "bash",
		ps1: "powershell",
		cxx: "cpp",
		cc: "cpp",
		cs: "csharp",
		rs: "rust",
		golang: "go",
		rb: "ruby",
		kt: "kotlin",
		yml: "yaml",
		html: "markup",
		xml: "markup",
		svg: "markup",
		md: "markdown",
		dockerfile: "docker",
	};

	const KEYWORDS = {
		javascript:
			"async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null return static super switch this throw true try typeof var void while with yield of from as",
		typescript:
			"async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null return static super switch this throw true try typeof var void while with yield of from as type interface enum implements private public protected readonly abstract declare namespace module never any unknown void",
		python:
			"and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case",
		bash: "if then else elif fi for in do done while until case esac function select time coproc true false",
		sql: "select from where and or not in is null join inner left right full outer on group by order asc desc limit offset insert into values update set delete create table alter drop index primary key unique constraint as having distinct union all case when then else end between like exists join",
		java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record sealed permits yield",
		c: "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool _Complex _Imaginary",
		cpp: "alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq",
		csharp:
			"abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var when yield await async record required",
		rust: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
		go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota",
		ruby: "alias and begin begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield",
		php: "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public require require_once return static switch throw trait try unset use var while xor yield true false null",
		kotlin:
			"as as? break class continue do else false for fun if in !in interface is !is null object package return super this throw true try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam where actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg",
		swift:
			"associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as Any catch false is nil super self Self throw throws true try #available #colorLiteral #column #else #elseif #endif #error #file #fileID #fileLiteral #filePath #function #if #imageLiteral #line #selector #sourceLocation #warning associativity convenience dynamic didSet final get infix indirect lazy left mutating none nonmutating optional override postfix precedence prefix Protocol required right set Type unowned weak willSet async await actor some",
		scala:
			"abstract case catch class def do else extends false final finally for forSome if implicit import lazy match new null object override package private protected return sealed super this throw trait true try type val var while with yield given using enum then",
		lua: "and break do else elseif end false for function goto if in local nil not or repeat return then true until while",
		r: "if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA NA_integer_ NA_real_ NA_complex_ NA_character_",
		dart: "abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return set show static super switch sync this throw true try typedef var void while with yield",
		graphql: "query mutation subscription fragment on true false null schema extend scalar type interface union enum input implements repeatable directive",
		powershell:
			"begin break catch class continue data define do dynamicparam else elseif end exit filter finally for foreach from function if in inlinescript parallel param process return switch throw trap try until using while workflow",
		docker: "FROM RUN CMD LABEL MAINTAINER EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS",
		objc: "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool id nil Nil YES NO self super @interface @implementation @end @property @synthesize @dynamic @protocol @optional @required @class @selector @encode @try @catch @finally @throw @synchronized @autoreleasepool @available",
	};

	function kwRe(list) {
		const words = list.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
		return new RegExp("\\b(?:" + words.join("|") + ")\\b");
	}

	function escapeRegExp(s) {
		return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	function escapeHtml(s) {
		return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	function langOf(name) {
		const key = String(name || "plaintext")
			.trim()
			.toLowerCase();
		return ALIASES[key] || key.replace(/\s+/g, "");
	}

	const C_LINE = { type: "comment", re: /\/\/[^\n]*/ };
	const C_BLOCK = { type: "comment", re: /\/\*[\s\S]*?\*\// };
	const HASH_COMMENT = { type: "comment", re: /#[^\n]*/ };
	const SQ = { type: "string", re: /'(?:\\.|[^'\\])*'/ };
	const DQ = { type: "string", re: /"(?:\\.|[^"\\])*"/ };
	const BQ = { type: "string", re: /`(?:\\.|[^`\\])*`/ };
	const NUM = { type: "number", re: /\b(?:0x[0-9a-fA-F]+|0b[01]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/ };

	function cLike(extraKeywords, extraRules = []) {
		const lang = extraKeywords;
		return [C_BLOCK, C_LINE, BQ, SQ, DQ, NUM, { type: "keyword", re: kwRe(KEYWORDS[lang] || "") }, ...extraRules];
	}

	const RULES = {
		javascript: cLike("javascript", [{ type: "comment", re: /\/\/[^\n]*/ }]),
		typescript: cLike("typescript"),
		java: cLike("java"),
		c: cLike("c"),
		cpp: cLike("cpp"),
		csharp: cLike("csharp"),
		rust: [
			{ type: "comment", re: /\/\/[^\n]*/ },
			C_BLOCK,
			{ type: "string", re: /b?"(?:\\.|[^"\\])*"/ },
			{ type: "string", re: /b?'(?:\\.|[^'\\])*'/ },
			{ type: "attribute", re: /#\[[^\]]*\]/ },
			{ type: "keyword", re: kwRe(KEYWORDS.rust) },
			{ type: "built_in", re: /\b(?:Some|None|Ok|Err|Vec|String|Option|Result)\b/ },
			NUM,
		],
		go: cLike("go"),
		kotlin: cLike("kotlin"),
		swift: cLike("swift"),
		dart: cLike("dart"),
		scala: cLike("scala"),
		php: [
			{ type: "comment", re: /\/\/[^\n]*/ },
			{ type: "comment", re: /#[^\n]*/ },
			C_BLOCK,
			SQ,
			DQ,
			BQ,
			{ type: "keyword", re: kwRe(KEYWORDS.php) },
			{ type: "variable", re: /\$[A-Za-z_][\w]*/ },
			NUM,
		],
		python: [
			{ type: "comment", re: /#[^\n]*/ },
			{
				type: "string",
				re: /(?:[fFrRbBuU]{0,3}"""[\s\S]*?"""|[fFrRbBuU]{0,3}'''[\s\S]*?'''|[fFrRbBuU]{0,3}"(?:\\.|[^"\\])*"|[fFrRbBuU]{0,3}'(?:\\.|[^'\\])*')/,
			},
			{ type: "keyword", re: kwRe(KEYWORDS.python) },
			{ type: "built_in", re: /\b(?:int|str|float|bool|list|dict|set|tuple|range|len|print|type|isinstance|None)\b/ },
			{ type: "decorator", re: /@[A-Za-z_]\w*/ },
			NUM,
		],
		ruby: [{ type: "comment", re: /#[^\n]*/ }, SQ, DQ, { type: "string", re: /:[A-Za-z_]\w*[?!]?/ }, { type: "keyword", re: kwRe(KEYWORDS.ruby) }, NUM],
		bash: [
			{ type: "comment", re: /#[^\n]*/ },
			SQ,
			DQ,
			{ type: "variable", re: /\$\{?[A-Za-z_]\w*\}?/ },
			{ type: "keyword", re: kwRe(KEYWORDS.bash) },
			{ type: "built_in", re: /\b(?:echo|cd|ls|pwd|export|alias|source|exit|return|printf|test|read|mkdir|rm|cp|mv|cat|grep|awk|sed)\b/ },
		],
		powershell: [
			{ type: "comment", re: /#[^\n]*/ },
			{ type: "comment", re: /<#[\s\S]*?#>/ },
			SQ,
			DQ,
			{ type: "variable", re: /\$[A-Za-z_]\w*/ },
			{ type: "keyword", re: kwRe(KEYWORDS.powershell) },
		],
		sql: [{ type: "comment", re: /--[^\n]*/ }, C_BLOCK, SQ, { type: "keyword", re: kwRe(KEYWORDS.sql) }, NUM],
		lua: [{ type: "comment", re: /--\[\[[\s\S]*?\]\]/ }, { type: "comment", re: /--[^\n]*/ }, SQ, DQ, { type: "keyword", re: kwRe(KEYWORDS.lua) }, NUM],
		r: [{ type: "comment", re: /#[^\n]*/ }, SQ, DQ, { type: "keyword", re: kwRe(KEYWORDS.r) }, NUM],
		graphql: [HASH_COMMENT, SQ, DQ, { type: "keyword", re: kwRe(KEYWORDS.graphql) }, NUM],
		docker: [HASH_COMMENT, SQ, DQ, { type: "keyword", re: kwRe(KEYWORDS.docker) }],
		objc: cLike("objc"),
		json: [{ type: "string", re: /"(?:\\.|[^"\\])*"(?=\s*:)/, as: "attr" }, DQ, { type: "keyword", re: /\b(?:true|false|null)\b/ }, NUM],
		yaml: [HASH_COMMENT, { type: "attr", re: /^[\t ]*[\w.-]+(?=\s*:)/m }, SQ, DQ, { type: "keyword", re: /\b(?:true|false|null|yes|no|on|off)\b/ }, NUM],
		toml: [HASH_COMMENT, { type: "attr", re: /^\s*\[[^\]]+\]/m }, SQ, DQ, { type: "keyword", re: /\b(?:true|false)\b/ }, NUM],
		css: [
			C_BLOCK,
			{ type: "comment", re: /\/\/[^\n]*/ },
			{ type: "selector", re: /[.#]?[A-Za-z_][\w-]*(?=\s*\{)/ },
			{ type: "attr", re: /[\w-]+(?=\s*:)/ },
			SQ,
			DQ,
			{ type: "number", re: /\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms)?\b/ },
		],
		markup: [
			{ type: "comment", re: /<!--[\s\S]*?-->/ },
			{ type: "string", re: /"(?:\\.|[^"\\])*"/ },
			{ type: "string", re: /'(?:\\.|[^'\\])*'/ },
			{ type: "tag", re: /<\/?[A-Za-z][\w:-]*/ },
			{ type: "attr", re: /[A-Za-z_:][\w:.-]*(?=\s*=)/ },
			{ type: "tag", re: /\/?>/ },
		],
		markdown: [
			{ type: "heading", re: /^#{1,6}[^\n]*/m },
			{ type: "comment", re: /<!--[\s\S]*?-->/ },
			{ type: "string", re: /`[^`]+`/ },
			{ type: "string", re: /\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_/ },
			{ type: "attr", re: /\[[^\]]+\]\([^)]+\)/ },
		],
		diff: [
			{ type: "inserted", re: /^\+[^\n]*/m },
			{ type: "deleted", re: /^-[^\n]*/m },
			{ type: "heading", re: /^(?:@@|[A-Za-z][^\n]*)/m },
		],
	};

	RULES.js = RULES.javascript;
	RULES.ts = RULES.typescript;
	RULES.py = RULES.python;

	function highlight(code, language) {
		const text = String(code ?? "");
		const lang = langOf(language);
		const rules = RULES[lang];
		if (!text || !rules) {
			return `<code class="nas-code-plain">${escapeHtml(text)}</code>`;
		}

		let out = "";
		let i = 0;
		const n = text.length;
		while (i < n) {
			let best = null;
			for (const rule of rules) {
				const slice = text.slice(i);
				const m = rule.re.exec(slice);
				if (!m || m.index !== 0 || !m[0]) continue;
				if (!best || m[0].length > best.value.length) {
					best = { type: rule.as || rule.type, value: m[0] };
				}
			}
			if (!best) {
				let j = i + 1;
				while (j < n) {
					let hit = false;
					const slice = text.slice(j);
					for (const rule of rules) {
						const m = rule.re.exec(slice);
						if (m && m.index === 0 && m[0]) {
							hit = true;
							break;
						}
					}
					if (hit) break;
					j += 1;
				}
				out += escapeHtml(text.slice(i, j));
				i = j;
				continue;
			}
			out += `<span class="hl-${best.type}">${escapeHtml(best.value)}</span>`;
			i += best.value.length;
		}
		return `<code class="language-${escapeHtml(lang)}">${out}</code>`;
	}

	return { highlight, langOf };
})();
