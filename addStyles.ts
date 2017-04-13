/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

interface Item extends Array<string | number> {
	readonly 0: number;
	readonly 1: string;
	readonly 2: string;
	readonly 3: string;
}

interface Style {
	readonly id: number;
	readonly parts: Part[];
}

interface StyleInDOM {
	readonly id: number;
	readonly parts: ((obj?: Obj) => void)[];
	refs: number;
}

interface Part {
	readonly css: string;
	readonly media: string;
	readonly sourceMap: string;
}

interface Options {
	convertToAbsoluteUrls?: boolean;
	singleton?: boolean;
	attrs?: {
		type?: string;
		rel?: string;
	};
	insertInto?: 'head';
	insertAt?: 'bottom' | 'top';
}

interface Obj {
	readonly css: string;
	readonly sourceMap: string;
	readonly media: string;
}

interface StyleElement extends HTMLStyleElement {
	readonly styleSheet?: {
		cssText: string;
	}
}

type Styles = Style[];

const stylesInDom = (() => {
	const cache: { [id: number]: [Style, StyleInDOM][] } = {};
	return {
		get(style: Style): StyleInDOM {
			const existing = cache[style.id];
			return existing ? existing.filter(s => s[0] === style).map(s => s[1])[0] : undefined;
		},
		set(style: Style, domStyle: StyleInDOM) {
			const existing = cache[style.id];
			if (!existing) {
				cache[style.id] = [[style, domStyle]];
			} else {
				for (let i = 0; i < existing.length; i++) {
					if (existing[i][0] === style) {
						existing[i][1] = domStyle;
						return;
					}
				}
				existing.push([style, domStyle]);
			}
		},
		delete(style: StyleInDOM) {
			let existing = cache[style.id];
			existing = existing ? existing.filter(s => s[1] !== style) : existing;
			if (!existing || !existing.length) {
				delete cache[style.id];
			}
		}
	};
})();

declare const DEBUG: boolean;
declare function unescape(str: string): string;

function memoize<I, O>(fn: (input: I) => O) {
	let memo: O;
	return function (input?: I) {
		if (memo === undefined) {
			memo = (fn.bind(this) as typeof fn)(input);
		}
		return memo;
	};
}

const isOldIE = memoize(function () {
	// Test for IE <= 9 as proposed by Browserhacks
	// @see http://browserhacks.com/#hack-e71d8692f65334173fee715c222cb805
	// Tests for existence of standard globals is to allow style-loader 
	// to operate correctly into non-standard environments
	// @see https://github.com/webpack-contrib/style-loader/issues/177
	return window && document && document.all && !window.atob;
});

const getElement = (function (fn) {
	const memo: { [selector: string]: ElementTagNameMap[keyof ElementTagNameMap] } = {};
	return function (selector: keyof ElementTagNameMap) {
		if (memo[selector] === undefined) {
			memo[selector] = (fn.bind(this) as typeof fn)(selector);
		}
		return memo[selector]
	};
})(function (styleTarget: keyof ElementTagNameMap) {
	return document.querySelector(styleTarget)
});
let singletonElement: StyleElement = null;
let singletonCounter = 0;
const styleElementsInsertedAtTop: StyleElement[] = [];
const fixUrls = require("./fixUrls");

export default function (list: Item[], options: Options) {
	if (typeof DEBUG !== "undefined" && DEBUG) {
		if (typeof document !== "object") throw new Error("The style-loader cannot be used in a non-browser environment");
	}

	options = options || {};
	options.attrs = typeof options.attrs === "object" ? options.attrs : {};

	// Force single-tag solution on IE6-9, which has a hard limit on the # of <style>
	// tags it will allow on a page
	if (options.singleton === undefined) {
		options.singleton = isOldIE();
	}

	// By default, add <style> tags to the <head> element
	if (options.insertInto === undefined) {
		options.insertInto = "head";
	}

	// By default, add <style> tags to the bottom of the target
	if (options.insertAt === undefined) {
		options.insertAt = "bottom";
	}

	const styles = listToStyles(list);
	addStylesToDom(styles, options);

	return function update(newList: Item[]) {
		const mayRemove: StyleInDOM[] = [];
		for (const style of styles) {
			const domStyle = stylesInDom.get(style);
			domStyle.refs--;
			mayRemove.push(domStyle);
		}
		if (newList) {
			const newStyles = listToStyles(newList);
			addStylesToDom(newStyles, options);
		}
		for (let i = 0; i < mayRemove.length; i++) {
			const domStyle = mayRemove[i];
			if (domStyle.refs === 0) {
				for (let j = 0; j < domStyle.parts.length; j++) {
					domStyle.parts[j]();
				}
				stylesInDom.delete(domStyle);
			}
		}
	};
};

function addStylesToDom(styles: Style[], options: Options) {
	for (const style of styles) {
		const domStyle = stylesInDom.get(style);
		if (domStyle) {
			domStyle.refs++;
			let j: number;
			for (j = 0; j < domStyle.parts.length; j++) {
				domStyle.parts[j](style.parts[j]);
			}
			for (; j < style.parts.length; j++) {
				domStyle.parts.push(addStyle(style.parts[j], options));
			}
		} else {
			const parts = [];
			for (let j = 0; j < style.parts.length; j++) {
				parts.push(addStyle(style.parts[j], options));
			}
			stylesInDom.set(style, { id: style.id, refs: 1, parts });
		}
	}
}

function listToStyles(list: Item[]): Styles {
	const result = [];
	const newStyles: { [id: number]: { id: number; parts: Part[] } } = {};
	for (let i = 0; i < list.length; i++) {
		const item = list[i];
		const [id, css, media, sourceMap] = item;
		const part: Part = { css, media, sourceMap };
		if (!newStyles[id]) {
			result.push(newStyles[id] = { id: id, parts: [part] });
		} else {
			newStyles[id].parts.push(part);
		}
	}
	return result;
}

function insertStyleElement(options: Options, styleElement: StyleElement) {
	const styleTarget = getElement(options.insertInto)
	if (!styleTarget) {
		throw new Error("Couldn't find a style target. This probably means that the value for the 'insertInto' parameter is invalid.");
	}
	const lastStyleElementInsertedAtTop = styleElementsInsertedAtTop[styleElementsInsertedAtTop.length - 1];
	if (options.insertAt === "top") {
		if (!lastStyleElementInsertedAtTop) {
			styleTarget.insertBefore(styleElement, styleTarget.firstChild);
		} else if (lastStyleElementInsertedAtTop.nextSibling) {
			styleTarget.insertBefore(styleElement, lastStyleElementInsertedAtTop.nextSibling);
		} else {
			styleTarget.appendChild(styleElement);
		}
		styleElementsInsertedAtTop.push(styleElement);
	} else if (options.insertAt === "bottom") {
		styleTarget.appendChild(styleElement);
	} else {
		throw new Error("Invalid value for parameter 'insertAt'. Must be 'top' or 'bottom'.");
	}
}

function removeStyleElement(styleElement: StyleElement) {
	styleElement.parentNode.removeChild(styleElement);
	const idx = styleElementsInsertedAtTop.indexOf(styleElement);
	if (idx >= 0) {
		styleElementsInsertedAtTop.splice(idx, 1);
	}
}

function createStyleElement(options: Options) {
	const styleElement = document.createElement("style");
	options.attrs.type = "text/css";

	attachTagAttrs(styleElement, options.attrs);
	insertStyleElement(options, styleElement);
	return styleElement;
}

function createLinkElement(options: Options) {
	const linkElement = document.createElement("link");
	options.attrs.type = "text/css";
	options.attrs.rel = "stylesheet";

	attachTagAttrs(linkElement, options.attrs);
	insertStyleElement(options, linkElement);
	return linkElement;
}

function attachTagAttrs(element: Element, attrs: { [key: string]: string }) {
	Object.keys(attrs).forEach(function (key) {
		element.setAttribute(key, attrs[key]);
	});
}

type Update = (obj: Obj) => void;
type Remove = (nothing?: undefined) => void;

function addStyle(obj: Obj, options: Options): Update | Remove {
	let
		styleElement: StyleElement | HTMLLinkElement,
		update: Update,
		remove: Remove;

	if (options.singleton) {
		const styleIndex = singletonCounter++;
		styleElement = singletonElement || (singletonElement = createStyleElement(options));
		update = applyToSingletonTag.bind(null, styleElement, styleIndex, false);
		remove = applyToSingletonTag.bind(null, styleElement, styleIndex, true);
	} else if (obj.sourceMap &&
		typeof URL === "function" &&
		typeof URL.createObjectURL === "function" &&
		typeof URL.revokeObjectURL === "function" &&
		typeof Blob === "function" &&
		typeof btoa === "function") {
		styleElement = createLinkElement(options);
		update = updateLink.bind(null, styleElement, options);
		remove = function () {
			removeStyleElement(styleElement);
			if ((styleElement as HTMLLinkElement).href)
				URL.revokeObjectURL((styleElement as HTMLLinkElement).href);
		};
	} else {
		styleElement = createStyleElement(options);
		update = applyToTag.bind(null, styleElement);
		remove = function () {
			removeStyleElement(styleElement);
		};
	}

	update(obj);

	return function updateStyle(newObj: Obj) {
		if (newObj) {
			if (newObj.css === obj.css && newObj.media === obj.media && newObj.sourceMap === obj.sourceMap) {
				return;
			}
			update(obj = newObj);
		} else {
			remove();
		}
	};
}

const replaceText = (function () {
	const textStore: string[] = [];

	return function (index: number, replacement: string) {
		textStore[index] = replacement;
		return textStore.filter(Boolean).join('\n');
	};
})();

function applyToSingletonTag(styleElement: StyleElement, index: number, remove: boolean, obj: Obj) {
	const css = remove ? "" : obj.css;

	if (styleElement.styleSheet) {
		styleElement.styleSheet.cssText = replaceText(index, css);
	} else {
		const cssNode = document.createTextNode(css);
		const childNodes = styleElement.childNodes;
		if (childNodes[index]) styleElement.removeChild(childNodes[index]);
		if (childNodes.length) {
			styleElement.insertBefore(cssNode, childNodes[index]);
		} else {
			styleElement.appendChild(cssNode);
		}
	}
}

function applyToTag(styleElement: StyleElement, obj: Obj) {
	const css = obj.css;
	const media = obj.media;

	if (media) {
		styleElement.setAttribute("media", media)
	}

	if (styleElement.styleSheet) {
		styleElement.styleSheet.cssText = css;
	} else {
		while (styleElement.firstChild) {
			styleElement.removeChild(styleElement.firstChild);
		}
		styleElement.appendChild(document.createTextNode(css));
	}
}

function updateLink(linkElement: HTMLLinkElement, options: Options, obj: Obj) {
	let css = obj.css;
	const sourceMap = obj.sourceMap;

	/* If convertToAbsoluteUrls isn't defined, but sourcemaps are enabled
	and there is no publicPath defined then lets turn convertToAbsoluteUrls
	on by default.  Otherwise default to the convertToAbsoluteUrls option
	directly
	*/
	const autoFixUrls = options.convertToAbsoluteUrls === undefined && sourceMap;

	if (options.convertToAbsoluteUrls || autoFixUrls) {
		css = fixUrls(css);
	}

	if (sourceMap) {
		// http://stackoverflow.com/a/26603875
		css += "\n/*# sourceMappingURL=data:application/json;base64," + btoa(unescape(encodeURIComponent(JSON.stringify(sourceMap)))) + " */";
	}

	const blob = new Blob([css], { type: "text/css" });

	const oldSrc = linkElement.href;

	linkElement.href = URL.createObjectURL(blob);

	if (oldSrc) {
		URL.revokeObjectURL(oldSrc);
	}
}
