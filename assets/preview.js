/**
 * CINQ Éditeur, inside the preview frame.
 *
 * Draws the hover and selection outlines, turns a click on a block into a
 * selection in the editor, and swaps the blocks for fresh ones when the editor
 * says the draft changed. It never navigates: links are inert in the preview.
 */
(function () {
	"use strict";

	if (window.parent === window) {
		return;
	}

	const ORIGIN = window.location.origin;
	const SOURCE = "cinq-wp-editor-preview";

	let labels = [];
	let selected = null;
	let hovered = null;
	let refreshToken = 0;
	let currentUids = [];

	const send = (message) => window.parent.postMessage({ source: SOURCE, ...message }, ORIGIN);
	const container = () => document.querySelector("[data-cinq-blocks]");
	const wrapperAt = (index) =>
		index === null || index === undefined ? null : document.querySelector(`[data-cinq-block="${index}"]`);

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

	const hoverBox = makeBox("is-hover");
	const selectBox = makeBox("is-selected");

	/**
	 * Union of the boxes of a block's children: its marker has no box of its own.
	 */
	function rectOf(wrapper) {
		let top = Infinity;
		let left = Infinity;
		let right = -Infinity;
		let bottom = -Infinity;

		for (const child of wrapper.children) {
			if (child.tagName === "STYLE" || child.tagName === "SCRIPT") {
				continue;
			}

			const rect = child.getBoundingClientRect();

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

	function place(box, index) {
		const wrapper = wrapperAt(index);
		const rect = wrapper ? rectOf(wrapper) : null;

		if (!rect) {
			box.hidden = true;
			return;
		}

		box.hidden = false;
		box.style.top = `${rect.top}px`;
		box.style.left = `${rect.left}px`;
		box.style.width = `${rect.width}px`;
		box.style.height = `${rect.height}px`;
		box.classList.toggle("is-at-top", rect.top < 24);
		box.firstChild.textContent = labels[index] || "";
	}

	let frame = 0;

	function redraw() {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			place(selectBox, selected);

			if (hovered !== null && hovered !== selected) {
				place(hoverBox, hovered);
			} else {
				hoverBox.hidden = true;
			}
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

			if (rectOf(wrapper)) {
				return;
			}

			const index = Number(wrapper.dataset.cinqBlock);
			const placeholder = document.createElement("div");

			placeholder.className = "cinq-wp-editor-empty";
			placeholder.textContent = `${labels[index] || "Bloc"} : ce bloc n’affiche rien ici. Un champ requis est peut-être vide, ou son contenu vient d’ailleurs (Yoast, Central, GitHub…).`;
			wrapper.appendChild(placeholder);
		});

		if (!wrappers.length) {
			const placeholder = document.createElement("div");

			placeholder.className = "cinq-wp-editor-empty is-page";
			placeholder.textContent = "Cette page n’a pas encore de bloc. Ajoutez-en un depuis le panneau de gauche.";
			root.appendChild(placeholder);
		}
	}

	function scrollToBlock(index) {
		const wrapper = wrapperAt(index);
		const rect = wrapper ? rectOf(wrapper) : null;

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
				wrapper.innerHTML = '<div class="cinq-wp-editor-loading">Chargement du bloc…</div>';
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

		const fresh = new DOMParser().parseFromString(html, "text/html").querySelector("[data-cinq-blocks]");
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

		switch (data.type) {
			case "labels":
				decorate();
				redraw();
				break;

			case "select":
				selected = data.index;
				redraw();

				if (data.scroll) {
					scrollToBlock(data.index);
				}
				break;

			case "hover":
				hovered = data.index;
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

			if (wrapper) {
				selected = Number(wrapper.dataset.cinqBlock);
				redraw();
				send({ type: "select", index: selected });
			}
		},
		true
	);

	document.addEventListener("submit", (event) => event.preventDefault(), true);

	document.addEventListener("mouseover", (event) => {
		const wrapper = event.target instanceof Element ? event.target.closest("[data-cinq-block]") : null;
		const index = wrapper ? Number(wrapper.dataset.cinqBlock) : null;

		if (index !== hovered) {
			hovered = index;
			redraw();
			send({ type: "hover", index });
		}
	});

	window.addEventListener("scroll", redraw, { passive: true });
	window.addEventListener("resize", redraw);
	new ResizeObserver(redraw).observe(document.body);

	decorate();
	send({ type: "ready" });
})();
