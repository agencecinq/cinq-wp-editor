/**
 * CINQ Éditeur, inside the preview frame.
 *
 * Draws the hover and selection outlines, turns a click on a block or a fixed
 * section into a selection in the editor, and swaps the blocks for fresh ones
 * when the editor says the draft changed. It never navigates: links are inert
 * in the preview.
 *
 * The theme names the fields it renders with `data-field`, a list of names
 * separated by spaces, as `class` is: the zone's stack, and the elements of
 * the fixed sections, such as a hero. What is outlined is a target: a block's
 * index, a number, or a section's key, a string.
 */
(function () {
	"use strict";

	if (window.parent === window) {
		return;
	}

	const ORIGIN = window.location.origin;
	const SOURCE = "cinq-wp-editor-preview";
	const { __, sprintf } = window.wp.i18n;
	const { zone, sections } = window.cinqWpEditorPreview;

	// Names the editor gives the blocks, by index, and the sections, by key.
	let labels = [];
	let sectionLabels = {};
	let selected = null;
	let hovered = null;
	let refreshToken = 0;
	let currentUids = [];

	const send = (message) => window.parent.postMessage({ source: SOURCE, ...message }, ORIGIN);
	const ZONE = `[data-field~="${CSS.escape(zone)}"]`;
	const container = () => document.querySelector(ZONE);
	const wrapperAt = (index) =>
		index === null || index === undefined ? null : document.querySelector(`[data-cinq-block="${index}"]`);
	const sectionByKey = (key) => sections.find((section) => section.key === key);
	const names = (element) => element.dataset.field.trim().split(/\s+/);
	const shows = (section, element) => names(element).some((name) => section.fields.includes(name));
	const toMessage = (target) => (typeof target === "string" ? { section: target } : { index: target });

	/**
	 * Elements rendering the fields of a section, outside the zone, whose
	 * blocks may name fields of their own the same way. An element inside
	 * another one of the section is left out: the outer one outlines it.
	 */
	function elementsOf(key) {
		const section = sectionByKey(key);
		const root = container();

		if (!section) {
			return [];
		}

		const elements = Array.from(document.querySelectorAll("[data-field]")).filter(
			(element) => shows(section, element) && !(root && root.contains(element))
		);

		return elements.filter((element) => !elements.some((other) => other !== element && other.contains(element)));
	}

	/**
	 * The section an element of the page belongs to, if any.
	 */
	function sectionAt(element) {
		const root = container();

		for (let node = element.closest("[data-field]"); node; node = node.parentElement && node.parentElement.closest("[data-field]")) {
			const section = sections.find((candidate) => shows(candidate, node));

			if (section && !(root && root.contains(node))) {
				return section.key;
			}
		}

		return null;
	}

	function makeBox(modifier) {
		const box = document.createElement("div");
		const label = document.createElement("span");

		box.className = `cinq-wp-editor-box ${modifier}`;
		box.hidden = true;
		label.className = "cinq-wp-editor-box__label";
		box.appendChild(label);
		document.body.appendChild(box);

		return box;
	}

	// One box per element of a section, one for a block: boxes are added as
	// a target needs them, and hidden when it needs fewer.
	const hoverBoxes = [];
	const selectBoxes = [];

	/**
	 * Union of the boxes of some elements: a block's children, as its marker
	 * has no box of its own, or the elements of a section.
	 */
	function rectOf(elements) {
		let top = Infinity;
		let left = Infinity;
		let right = -Infinity;
		let bottom = -Infinity;

		for (const element of elements) {
			if (element.tagName === "STYLE" || element.tagName === "SCRIPT") {
				continue;
			}

			const rect = element.getBoundingClientRect();

			if (!rect.width && !rect.height) {
				continue;
			}

			top = Math.min(top, rect.top);
			left = Math.min(left, rect.left);
			right = Math.max(right, rect.right);
			bottom = Math.max(bottom, rect.bottom);
		}

		if (top === Infinity) {
			return null;
		}

		return {
			top: top + window.scrollY,
			left: left + window.scrollX,
			width: right - left,
			height: bottom - top,
		};
	}

	/**
	 * Boxes of a target, from the top of the page: one per element of a
	 * section, so that what lies between two of them is not outlined.
	 */
	function rectsOf(target) {
		if (typeof target === "string") {
			return elementsOf(target)
				.map((element) => rectOf([element]))
				.filter(Boolean)
				.sort((a, b) => a.top - b.top);
		}

		const wrapper = wrapperAt(target);
		const rect = wrapper ? rectOf(wrapper.children) : null;

		return rect ? [rect] : [];
	}

	function labelOf(target) {
		return (typeof target === "string" ? sectionLabels[target] : labels[target]) || "";
	}

	/**
	 * Outlines a target, its label on the first box; null hides the boxes.
	 */
	function place(boxes, modifier, target) {
		const rects = target === null ? [] : rectsOf(target);

		rects.forEach((rect, position) => {
			boxes[position] ??= makeBox(modifier);

			const box = boxes[position];

			box.hidden = false;
			box.style.top = `${rect.top}px`;
			box.style.left = `${rect.left}px`;
			box.style.width = `${rect.width}px`;
			box.style.height = `${rect.height}px`;
			box.classList.toggle("is-at-top", rect.top < 24);
			box.firstChild.textContent = position === 0 ? labelOf(target) : "";
		});

		boxes.slice(rects.length).forEach((box) => (box.hidden = true));
	}

	let frame = 0;

	function redraw() {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			place(selectBoxes, "is-selected", selected);
			place(hoverBoxes, "is-hover", hovered === selected ? null : hovered);
		});
	}

	/**
	 * Gives an empty block, or an empty page, something to click on.
	 */
	function decorate() {
		const root = container();

		if (!root) {
			return;
		}

		root.querySelectorAll(":scope > .cinq-wp-editor-empty").forEach((node) => node.remove());

		const wrappers = root.querySelectorAll("[data-cinq-block]");

		wrappers.forEach((wrapper) => {
			wrapper.querySelectorAll(":scope > .cinq-wp-editor-empty").forEach((node) => node.remove());

			if (rectOf(wrapper.children)) {
				return;
			}

			const index = Number(wrapper.dataset.cinqBlock);
			const placeholder = document.createElement("div");

			placeholder.className = "cinq-wp-editor-empty";
			placeholder.textContent = sprintf(
				/* translators: %s: Block name. */
				__("%s: this block shows nothing here. A required field may be empty, or its content comes from elsewhere (Yoast, Central, GitHub…).", "cinq-wp-editor"),
				labels[index] || __("Block", "cinq-wp-editor")
			);
			wrapper.appendChild(placeholder);
		});

		if (!wrappers.length) {
			const placeholder = document.createElement("div");

			placeholder.className = "cinq-wp-editor-empty is-page";
			placeholder.textContent = __("This page has no block yet. Add one from the panel on the left.", "cinq-wp-editor");
			root.appendChild(placeholder);
		}
	}

	function scrollToTarget(target) {
		const [rect] = target === null ? [] : rectsOf(target);

		if (rect) {
			window.scrollTo({ top: Math.max(0, rect.top - 80), behavior: "smooth" });
		}
	}

	/**
	 * Puts the blocks in the editor's order, addressed by the editor's ids.
	 *
	 * Blocks rendered by the server carry no id yet: they take the ids in
	 * order. A block the editor knows but the page does not (just added, not
	 * rendered yet) gets a placeholder until its HTML arrives.
	 */
	function applyOrder(uids) {
		const root = container();

		currentUids = uids;

		if (!root) {
			return;
		}

		const wrappers = Array.from(root.querySelectorAll(":scope > [data-cinq-block]"));
		const byUid = new Map();

		wrappers.forEach((wrapper, position) => {
			if (!wrapper.dataset.cinqUid && uids[position]) {
				wrapper.dataset.cinqUid = uids[position];
			}
			byUid.set(wrapper.dataset.cinqUid, wrapper);
		});

		wrappers.forEach((wrapper) => {
			if (!uids.includes(wrapper.dataset.cinqUid)) {
				wrapper.remove();
			}
		});

		uids.forEach((uid, position) => {
			let wrapper = byUid.get(uid);

			if (!wrapper) {
				wrapper = document.createElement("div");
				wrapper.style.display = "contents";
				wrapper.dataset.cinqUid = uid;
				const loading = document.createElement("div");

				loading.className = "cinq-wp-editor-loading";
				loading.textContent = __("Loading the block…", "cinq-wp-editor");
				wrapper.appendChild(loading);
			}

			wrapper.dataset.cinqBlock = String(position);

			// Only moves what is out of place: a block moved needlessly would
			// lose its state (an open accordion) for nothing.
			const atPosition = root.querySelectorAll(":scope > [data-cinq-block]")[position];

			if (atPosition !== wrapper) {
				root.insertBefore(wrapper, atPosition || null);
			}
		});

		decorate();
		redraw();
	}

	/**
	 * Swaps one block for the HTML the server rendered for it.
	 */
	function replaceBlock(uid, html) {
		const current = document.querySelector(`[data-cinq-uid="${uid}"]`);
		const template = document.createElement("template");

		template.innerHTML = html;

		const fresh = template.content.querySelector("[data-cinq-block]");

		if (!current || !fresh) {
			refresh();
			return;
		}

		fresh.dataset.cinqUid = uid;
		fresh.dataset.cinqBlock = current.dataset.cinqBlock;
		current.replaceWith(document.adoptNode(fresh));

		decorate();
		redraw();
	}

	/**
	 * Fetches the whole page again and swaps all its blocks in: the fallback
	 * when a block cannot be rendered alone.
	 */
	async function refresh() {
		const token = ++refreshToken;
		const response = await fetch(window.location.href, { credentials: "same-origin", cache: "no-store" });
		const html = await response.text();

		if (token !== refreshToken) {
			return;
		}

		const fresh = new DOMParser().parseFromString(html, "text/html").querySelector(ZONE);
		const root = container();

		if (!fresh || !root) {
			window.location.reload();
			return;
		}

		root.replaceChildren(...Array.from(fresh.childNodes).map((node) => document.adoptNode(node)));
		applyOrder(currentUids);
	}

	window.addEventListener("message", (event) => {
		const data = event.data;

		if (event.origin !== ORIGIN || !data || data.source !== "cinq-wp-editor") {
			return;
		}

		if (Array.isArray(data.labels)) {
			labels = data.labels;
		}

		if (data.sectionLabels) {
			sectionLabels = data.sectionLabels;
		}

		switch (data.type) {
			case "labels":
				decorate();
				redraw();
				break;

			case "select":
				selected = data.section ?? data.index ?? null;
				redraw();

				if (data.scroll) {
					scrollToTarget(selected);
				}
				break;

			case "hover":
				hovered = data.section ?? data.index ?? null;
				redraw();
				break;

			case "theme":
				if (data.rgb) {
					document.documentElement.style.setProperty("--cinq-wp-editor-accent", data.rgb);
				}
				break;

			case "order":
				applyOrder(Array.isArray(data.uids) ? data.uids : []);
				break;

			case "replace":
				replaceBlock(data.uid, data.html);
				break;

			case "refresh":
				refresh().catch(() => window.location.reload());
				break;
		}
	});

	document.addEventListener(
		"click",
		(event) => {
			const target = event.target instanceof Element ? event.target : null;

			if (!target) {
				return;
			}

			// Links and submits stay inert; buttons keep working, so an
			// accordion or a switch can still be tried in the preview.
			if (target.closest("a[href], [type='submit']")) {
				event.preventDefault();
			}

			const wrapper = target.closest("[data-cinq-block]");
			const next = wrapper ? Number(wrapper.dataset.cinqBlock) : sectionAt(target);

			if (next !== null) {
				selected = next;
				redraw();
				send({ type: "select", ...toMessage(selected) });
			}
		},
		true
	);

	document.addEventListener("submit", (event) => event.preventDefault(), true);

	document.addEventListener("mouseover", (event) => {
		const target = event.target instanceof Element ? event.target : null;
		const wrapper = target ? target.closest("[data-cinq-block]") : null;
		let next = null;

		if (wrapper) {
			next = Number(wrapper.dataset.cinqBlock);
		} else if (target) {
			next = sectionAt(target);
		}

		if (next !== hovered) {
			hovered = next;
			redraw();
			send({ type: "hover", ...toMessage(next) });
		}
	});

	window.addEventListener("scroll", redraw, { passive: true });
	window.addEventListener("resize", redraw);
	new ResizeObserver(redraw).observe(document.body);

	decorate();
	// ⌘S / Ctrl+S in the preview publishes, as it does in the editor.
	document.addEventListener("keydown", (event) => {
		if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s") {
			event.preventDefault();
			send({ type: "save" });
		}
	});

	// The editor warns when the template renders no block zone.
	send({ type: "ready", blocks: Boolean(container()) });
})();
