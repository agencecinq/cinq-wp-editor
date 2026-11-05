/**
 * CINQ Éditeur.
 *
 * Three columns: the blocks of the page on the left, the real page in the
 * middle, the fields of the selected block on the right. Every change is saved
 * as the user's draft after a short pause, then the preview fetches the page
 * again and swaps the changed block in.
 *
 * Written against the WordPress globals (wp.element, wp.components), without a
 * build step, so the prototype runs as soon as the plugin is activated.
 */
(function (wp, config) {
	"use strict";

	const { createElement: h, Fragment, useState, useEffect, useRef, useMemo, createRoot } = wp.element;
	const {
		BaseControl,
		Button,
		CheckboxControl,
		Modal,
		Notice,
		PanelBody,
		SearchControl,
		SelectControl,
		Spinner,
		TextControl,
		TextareaControl,
		ToggleControl,
	} = wp.components;
	const apiFetch = wp.apiFetch;
	// The classic editor's API: `wp.editor` until the block editor takes the name.
	const classicEditor = wp.oldEditor || wp.editor;
	const { addQueryArgs } = wp.url;

	const SAVE_DELAY = 300;
	const ORIGIN = window.location.origin;
	const API = `/${config.namespace}/posts/${config.postId}`;

	let uidSeed = 0;
	const uid = () => `block-${++uidSeed}`;
	const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
	const toArray = (value) => (Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value]);

	/* ------------------------------------------------------------------ */
	/* Values                                                              */
	/* ------------------------------------------------------------------ */

	function defaultsFor(fields) {
		const values = {};

		(fields || []).forEach((field) => {
			const value = defaultFor(field);

			if (value !== undefined) {
				values[field.name] = value;
			}
		});

		return values;
	}

	function defaultFor(field) {
		const fallback = field.default_value;

		switch (field.type) {
			case "group":
				return defaultsFor(field.sub_fields);

			case "repeater":
				return Array.from({ length: Number(field.min) || 0 }, () => defaultsFor(field.sub_fields));

			case "flexible_content":
				return [];

			case "true_false":
				return Boolean(Number(fallback));

			case "checkbox":
				return toArray(fallback);

			case "select":
				if (field.multiple) {
					return toArray(fallback);
				}
				return Array.isArray(fallback) ? fallback[0] : fallback === "" || fallback === null ? undefined : fallback;

			case "link":
				return fallback && typeof fallback === "object" ? copy(fallback) : undefined;

			default:
				return fallback === undefined || fallback === null || fallback === "" || Array.isArray(fallback) ? undefined : fallback;
		}
	}

	/**
	 * ACF conditional logic, against the sibling fields only.
	 *
	 * A rule pointing at a field that is not a sibling is considered met: the
	 * field shows, which is the safe side.
	 */
	function isVisible(field, siblings, values) {
		const groups = field.conditional_logic;

		if (!Array.isArray(groups) || !groups.length) {
			return true;
		}

		const byKey = {};
		siblings.forEach((sibling) => (byKey[sibling.key] = sibling));

		return groups.some((rules) =>
			(rules || []).every((rule) => {
				const target = byKey[rule.field];

				if (!target) {
					return true;
				}

				const value = values ? values[target.name] : undefined;
				const empty = value === undefined || value === null || value === "" || value === false || value === "0" || (Array.isArray(value) && !value.length);
				const asString = target.type === "true_false" ? (value === true || Number(value) === 1 ? "1" : "0") : String(value ?? "");
				const equals = Array.isArray(value) ? value.map(String).includes(String(rule.value)) : asString === String(rule.value);

				switch (rule.operator) {
					case "==":
						return equals;
					case "!=":
						return !equals;
					case "==empty":
						return empty;
					case "!=empty":
						return !empty;
					case "==contains":
						return asString.includes(String(rule.value));
					case "!=contains":
						return !asString.includes(String(rule.value));
					default:
						return true;
				}
			})
		);
	}

	/**
	 * A line of text that tells two blocks of the same type apart in the list.
	 */
	function summaryOf(value) {
		const found = [];

		(function walk(node, depth) {
			if (found.length || depth > 4 || node === null || node === undefined) {
				return;
			}

			if (typeof node === "string") {
				const text = node.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

				if (text.includes(" ") && !/^https?:/.test(text)) {
					found.push(text);
				}
				return;
			}

			if (Array.isArray(node)) {
				node.forEach((item) => walk(item, depth + 1));
				return;
			}

			if (typeof node === "object") {
				const keys = Object.keys(node).filter((key) => key !== "acf_fc_layout" && key !== "layout");
				const preferred = ["content", "title", "heading", "text"];

				keys.sort((a, b) => {
					const rank = (key) => (preferred.includes(key) ? preferred.indexOf(key) : preferred.length);
					return rank(a) - rank(b);
				});
				keys.forEach((key) => walk(node[key], depth + 1));
			}
		})(value, 0);

		return found[0] || "";
	}

	const errorsAt = (errors, path) => errors.filter((error) => error.path === path).map((error) => error.message);
	const errorsUnder = (errors, path) => errors.filter((error) => error.path === path || error.path.startsWith(`${path}.`) || error.path.startsWith(`${path}[`));

	/* ------------------------------------------------------------------ */
	/* Fields                                                              */
	/* ------------------------------------------------------------------ */

	function Fields({ fields, value, onChange, path, errors }) {
		const values = value && typeof value === "object" && !Array.isArray(value) ? value : {};

		return h(
			Fragment,
			null,
			(fields || [])
				.filter((field) => isVisible(field, fields, values))
				.map((field) =>
					h(Field, {
						key: field.key || field.name,
						field,
						value: values[field.name],
						onChange: (next) => onChange({ ...values, [field.name]: next }),
						path: `${path}.${field.name}`,
						errors,
					})
				)
		);
	}

	function Field({ field, value, onChange, path, errors }) {
		const label = field.label + (Number(field.required) ? " *" : "");
		const help = field.instructions || undefined;
		const own = errorsAt(errors, path);
		const common = { label, help, __nextHasNoMarginBottom: true };
		let control;

		switch (field.type) {
			case "group":
				return h(
					"fieldset",
					{ className: "cinq-group" },
					h("legend", null, field.label),
					help && h("p", { className: "cinq-help" }, help),
					h(Fields, { fields: field.sub_fields, value, onChange, path, errors })
				);

			case "repeater":
				return h(RepeaterField, { field, value, onChange, path, errors });

			case "text":
			case "email":
			case "url":
			case "password":
			case "oembed":
			case "date_picker":
			case "date_time_picker":
			case "time_picker":
				control = h(TextControl, {
					...common,
					type: field.type === "email" ? "email" : field.type === "url" ? "url" : "text",
					value: value ?? "",
					placeholder: field.placeholder || undefined,
					onChange,
				});
				break;

			case "number":
			case "range":
				control = h(TextControl, {
					...common,
					type: "number",
					min: field.min,
					max: field.max,
					step: field.step || undefined,
					value: value ?? "",
					onChange: (next) => onChange(next === "" ? "" : Number(next)),
				});
				break;

			case "color_picker":
				control = h(TextControl, { ...common, type: "color", value: value || "#000000", onChange });
				break;

			case "textarea":
				control = h(TextareaControl, {
					...common,
					rows: Number(field.rows) || 3,
					value: value ?? "",
					placeholder: field.placeholder || undefined,
					onChange,
				});
				break;

			case "wysiwyg":
				// One editor per field and block: another block remounts it.
				control = h(WysiwygField, { key: path, field, label, help, value, onChange });
				break;

			case "true_false":
				// ACF stores true_false as "1" / "0": the string "0" is truthy.
				control = h(ToggleControl, { ...common, checked: value === true || Number(value) === 1, onChange });
				break;

			case "select":
			case "radio":
			case "button_group":
				if (field.multiple) {
					control = h(ChoiceList, { field, label, help, value, onChange });
					break;
				}

				control = h(SelectControl, {
					...common,
					value: value ?? "",
					options: [
						...(Number(field.allow_null) || !Number(field.required) ? [{ label: "—", value: "" }] : []),
						...Object.entries(field.choices || {}).map(([choice, text]) => ({ value: choice, label: String(text) })),
					],
					onChange,
				});
				break;

			case "checkbox":
				control = h(ChoiceList, { field, label, help, value, onChange });
				break;

			case "link":
				control = h(LinkField, { label, help, value, onChange });
				break;

			case "image":
			case "file":
				control = h(MediaField, { field, label, help, value, onChange });
				break;

			case "gallery":
				control = h(GalleryField, { field, label, help, value, onChange });
				break;

			case "post_object":
			case "relationship":
				control = h(PostField, { field, label, help, value, onChange });
				break;

			case "taxonomy":
				control = h(TextControl, {
					...common,
					help: [help, "Identifiants des termes, séparés par des virgules."].filter(Boolean).join(" "),
					value: toArray(value).join(", "),
					onChange: (next) =>
						onChange(
							next
								.split(",")
								.map((item) => item.trim())
								.filter(Boolean)
						),
				});
				break;

			default:
				control = h(
					"div",
					{ className: "cinq-unsupported" },
					h("strong", null, field.label),
					h("p", null, `Champ « ${field.type} » : à modifier dans l’éditeur classique pour l’instant.`)
				);
		}

		return h(
			"div",
			{ className: `cinq-field cinq-field--${field.type}${own.length ? " has-error" : ""}` },
			control,
			own.map((message, index) => h("p", { key: index, className: "cinq-error" }, message))
		);
	}

	let editorSeed = 0;

	/**
	 * TinyMCE, as ACF and the classic edit screen run it: same toolbars (ACF's,
	 * with the theme's `acf/fields/wysiwyg/toolbars`), same Visual / Code tabs,
	 * same « Ajouter un média » button. The textarea is created outside React,
	 * which must not touch the markup TinyMCE builds around it.
	 */
	function WysiwygField({ field, label, help, value, onChange }) {
		const id = useMemo(() => `cinq-wysiwyg-${++editorSeed}`, []);
		const holder = useRef(null);
		const content = useRef(value ?? "");
		const latest = useRef(onChange);

		latest.current = onChange;

		useEffect(() => {
			const node = holder.current;
			const textarea = document.createElement("textarea");
			const tabs = field.tabs || "all";
			const toolbar = config.toolbars[field.toolbar] || config.toolbars.full || {};

			textarea.id = id;
			textarea.className = "wp-editor-area";
			textarea.rows = 10;
			textarea.value = content.current;
			node.appendChild(textarea);

			const emit = () => {
				const next = classicEditor.getContent(id);

				if (next !== content.current) {
					content.current = next;
					latest.current(next);
				}
			};

			classicEditor.initialize(id, {
				tinymce:
					tabs === "text"
						? false
						: {
								wpautop: true,
								toolbar1: toolbar[1] || "",
								toolbar2: toolbar[2] || "",
								toolbar3: toolbar[3] || "",
								toolbar4: toolbar[4] || "",
								setup: (editor) => editor.on("input change undo redo ExecCommand", emit),
							},
				quicktags: tabs !== "visual",
				mediaButtons: Number(field.media_upload) === 1,
			});

			// The Code tab, and the editor without TinyMCE, type in the textarea.
			textarea.addEventListener("input", emit);

			return () => {
				textarea.removeEventListener("input", emit);
				classicEditor.remove(id);
				node.replaceChildren();
			};
		}, [id]);

		// A value changed from outside, by « Abandonner » for instance.
		useEffect(() => {
			const next = value ?? "";

			if (next === content.current) {
				return;
			}

			content.current = next;

			const editor = window.tinymce && window.tinymce.get(id);

			if (editor && !editor.isHidden()) {
				editor.setContent(classicEditor.autop ? classicEditor.autop(next) : next);
			} else {
				document.getElementById(id).value = next;
			}
		}, [value]);

		return h(BaseControl, { id, label, help, __nextHasNoMarginBottom: true }, h("div", { ref: holder, className: "cinq-wysiwyg" }));
	}

	/**
	 * A confirmation, as the block editor asks one: a small modal, the
	 * destructive action in red, Escape or « Annuler » to back out.
	 */
	function Confirm({ title, text, label, onConfirm, onCancel }) {
		return h(
			Modal,
			{ title, size: "small", onRequestClose: onCancel },
			h("p", { className: "cinq-confirm__text" }, text),
			h(
				"div",
				{ className: "cinq-confirm__actions" },
				h(Button, { variant: "tertiary", onClick: onCancel }, "Annuler"),
				h(Button, { variant: "primary", isDestructive: true, onClick: onConfirm }, label)
			)
		);
	}

	function ChoiceList({ field, label, help, value, onChange }) {
		const selected = toArray(value).map(String);

		return h(
			"fieldset",
			{ className: "cinq-choices" },
			h("legend", null, label),
			Object.entries(field.choices || {}).map(([choice, text]) =>
				h(CheckboxControl, {
					key: choice,
					label: String(text),
					checked: selected.includes(choice),
					onChange: (checked) => onChange(checked ? [...selected, choice] : selected.filter((item) => item !== choice)),
					__nextHasNoMarginBottom: true,
				})
			),
			help && h("p", { className: "cinq-help" }, help)
		);
	}

	function LinkField({ label, help, value, onChange }) {
		const link = value && typeof value === "object" ? value : { title: "", url: "", target: "" };
		const set = (key, next) => onChange({ ...link, [key]: next });

		return h(
			"fieldset",
			{ className: "cinq-link" },
			h("legend", null, label),
			h(TextControl, { label: "Texte du lien", value: link.title || "", onChange: (next) => set("title", next), __nextHasNoMarginBottom: true }),
			h(TextControl, {
				label: "Adresse",
				type: "url",
				value: link.url || "",
				placeholder: "/contact/ ou https://…",
				onChange: (next) => set("url", next),
				__nextHasNoMarginBottom: true,
			}),
			h(ToggleControl, {
				label: "Ouvrir dans un nouvel onglet",
				checked: link.target === "_blank",
				onChange: (checked) => set("target", checked ? "_blank" : ""),
				__nextHasNoMarginBottom: true,
			}),
			help && h("p", { className: "cinq-help" }, help)
		);
	}

	function useAttachment(id) {
		const [attachment, setAttachment] = useState(null);

		useEffect(() => {
			if (!id) {
				setAttachment(null);
				return;
			}

			let alive = true;
			const model = wp.media.attachment(id);

			model
				.fetch()
				.then(() => alive && setAttachment(model.toJSON()))
				.catch(() => alive && setAttachment(null));

			return () => {
				alive = false;
			};
		}, [id]);

		return attachment;
	}

	function Thumbnail({ id }) {
		const attachment = useAttachment(id);

		if (!attachment) {
			return h("span", { className: "cinq-thumb is-loading" }, `#${id}`);
		}

		const sizes = attachment.sizes || {};
		const src = (sizes.medium || sizes.thumbnail || {}).url || (attachment.type === "image" ? attachment.url : "");

		return src
			? h("img", { className: "cinq-thumb", src, alt: attachment.alt || "" })
			: h("span", { className: "cinq-thumb is-file" }, attachment.filename || `#${id}`);
	}

	function openMediaFrame(field, multiple, onSelect) {
		const frame = wp.media({
			title: field.label,
			multiple,
			library: field.type === "image" || field.type === "gallery" ? { type: "image" } : {},
			button: { text: "Utiliser" },
		});

		frame.on("select", () => {
			const ids = frame
				.state()
				.get("selection")
				.map((attachment) => attachment.id);
			onSelect(ids);
		});
		frame.open();
	}

	function MediaField({ field, label, help, value, onChange }) {
		const id = Number(value) || 0;

		return h(
			"div",
			{ className: "cinq-media" },
			h("span", { className: "cinq-label" }, label),
			id ? h(Thumbnail, { id }) : null,
			h(
				"div",
				{ className: "cinq-media__actions" },
				h(Button, { variant: "secondary", size: "compact", onClick: () => openMediaFrame(field, false, (ids) => onChange(ids[0] || "")) }, id ? "Remplacer" : "Choisir"),
				id ? h(Button, { variant: "tertiary", size: "compact", isDestructive: true, onClick: () => onChange("") }, "Retirer") : null
			),
			help && h("p", { className: "cinq-help" }, help)
		);
	}

	function GalleryField({ field, label, help, value, onChange }) {
		const ids = toArray(value).map(Number).filter(Boolean);

		return h(
			"div",
			{ className: "cinq-media" },
			h("span", { className: "cinq-label" }, label),
			h(
				"div",
				{ className: "cinq-gallery" },
				ids.map((id) =>
					h(
						"span",
						{ key: id, className: "cinq-gallery__item" },
						h(Thumbnail, { id }),
						h(Button, { icon: "no-alt", size: "small", label: "Retirer", onClick: () => onChange(ids.filter((item) => item !== id)) })
					)
				)
			),
			h(Button, { variant: "secondary", size: "compact", onClick: () => openMediaFrame(field, true, (picked) => onChange([...ids, ...picked])) }, "Ajouter des images"),
			help && h("p", { className: "cinq-help" }, help)
		);
	}

	function PostField({ field, label, help, value, onChange }) {
		const multiple = field.type === "relationship" || Boolean(Number(field.multiple));
		const ids = toArray(value).map(Number).filter(Boolean);
		const subtype = Array.isArray(field.post_type) && field.post_type.length ? field.post_type.join(",") : "any";
		const [titles, setTitles] = useState({});
		const [query, setQuery] = useState("");
		const [results, setResults] = useState([]);

		useEffect(() => {
			const missing = ids.filter((id) => !(id in titles));

			if (!missing.length) {
				return;
			}

			apiFetch({ path: addQueryArgs("/wp/v2/search", { include: missing.join(","), type: "post", subtype, per_page: missing.length }) })
				.then((list) => setTitles((known) => ({ ...known, ...Object.fromEntries(list.map((item) => [item.id, item.title])) })))
				.catch(() => {});
		}, [ids.join(",")]);

		useEffect(() => {
			if (query.trim().length < 2) {
				setResults([]);
				return;
			}

			const timer = setTimeout(() => {
				apiFetch({ path: addQueryArgs("/wp/v2/search", { search: query, type: "post", subtype, per_page: 8 }) })
					.then(setResults)
					.catch(() => setResults([]));
			}, 250);

			return () => clearTimeout(timer);
		}, [query]);

		const set = (next) => onChange(multiple ? next : next.length ? next[next.length - 1] : "");

		return h(
			"div",
			{ className: "cinq-posts" },
			h("span", { className: "cinq-label" }, label),
			ids.length
				? h(
						"ul",
						{ className: "cinq-posts__selected" },
						ids.map((id) =>
							h(
								"li",
								{ key: id },
								h("span", null, titles[id] || `#${id}`),
								h(Button, { icon: "no-alt", size: "small", label: "Retirer", onClick: () => set(ids.filter((item) => item !== id)) })
							)
						)
				  )
				: h("p", { className: "cinq-help" }, multiple ? "Aucun contenu choisi." : "Aucun contenu choisi."),
			h(SearchControl, { value: query, onChange: setQuery, placeholder: "Rechercher un contenu…", __nextHasNoMarginBottom: true }),
			results.length
				? h(
						"ul",
						{ className: "cinq-posts__results" },
						results
							.filter((item) => !ids.includes(item.id))
							.map((item) =>
								h(
									"li",
									{ key: item.id },
									h(
										Button,
										{
											variant: "link",
											onClick: () => {
												setTitles((known) => ({ ...known, [item.id]: item.title }));
												set([...ids, item.id]);
												setQuery("");
											},
										},
										item.title || `#${item.id}`
									)
								)
							)
				  )
				: null,
			help && h("p", { className: "cinq-help" }, help)
		);
	}

	function RepeaterField({ field, value, onChange, path, errors }) {
		const rows = Array.isArray(value) ? value : [];
		const [open, setOpen] = useState(null);
		const max = Number(field.max) || 0;
		const min = Number(field.min) || 0;

		const update = (index, row) => onChange(rows.map((item, position) => (position === index ? row : item)));
		const remove = (index) => {
			onChange(rows.filter((item, position) => position !== index));
			setOpen(null);
		};
		const move = (index, delta) => {
			const next = rows.slice();
			const [row] = next.splice(index, 1);
			next.splice(index + delta, 0, row);
			onChange(next);
			setOpen(open === index ? index + delta : open);
		};
		const add = () => {
			onChange([...rows, defaultsFor(field.sub_fields)]);
			setOpen(rows.length);
		};

		return h(
			"fieldset",
			{ className: "cinq-repeater" },
			h("legend", null, field.label, h("span", { className: "cinq-count" }, rows.length)),
			field.instructions && h("p", { className: "cinq-help" }, field.instructions),
			h(
				"ol",
				{ className: "cinq-repeater__rows" },
				rows.map((row, index) => {
					const rowPath = `${path}[${index}]`;
					const hasError = errorsUnder(errors, rowPath).length > 0;

					return h(
						"li",
						{ key: index, className: `cinq-repeater__row${open === index ? " is-open" : ""}${hasError ? " has-error" : ""}` },
						h(
							"div",
							{ className: "cinq-repeater__head" },
							h(
								"button",
								{ type: "button", className: "cinq-repeater__toggle", "aria-expanded": open === index, onClick: () => setOpen(open === index ? null : index) },
								h("span", { className: "cinq-repeater__index" }, String(index + 1).padStart(2, "0")),
								h("span", { className: "cinq-repeater__summary" }, summaryOf(row) || "Élément vide")
							),
							h(Button, { icon: "arrow-up-alt2", size: "small", label: "Monter", disabled: index === 0, onClick: () => move(index, -1) }),
							h(Button, { icon: "arrow-down-alt2", size: "small", label: "Descendre", disabled: index === rows.length - 1, onClick: () => move(index, 1) }),
							h(Button, { icon: "trash", size: "small", label: "Supprimer", isDestructive: true, disabled: rows.length <= min, onClick: () => remove(index) })
						),
						open === index && h("div", { className: "cinq-repeater__body" }, h(Fields, { fields: field.sub_fields, value: row, onChange: (next) => update(index, next), path: rowPath, errors }))
					);
				})
			),
			h(Button, { variant: "secondary", size: "compact", icon: "plus", disabled: max > 0 && rows.length >= max, onClick: add }, field.button_label || "Ajouter un élément"),
			errorsAt(errors, path).map((message, index) => h("p", { key: index, className: "cinq-error" }, message))
		);
	}

	/* ------------------------------------------------------------------ */
	/* Panels                                                              */
	/* ------------------------------------------------------------------ */

	function BlockList({ items, layouts, selected, hovered, errors, onSelect, onHover, onMove, onRemove, onDuplicate, onAdd }) {
		const [dragging, setDragging] = useState(null);
		const [over, setOver] = useState(null);

		return h(
			"aside",
			{ className: "cinq-panel cinq-blocks", "aria-label": "Blocs de la page" },
			h("h2", { className: "cinq-panel__title" }, "Blocs", h("span", { className: "cinq-count" }, items.length)),
			h(
				"ol",
				{ className: "cinq-blocks__list" },
				items.map((item, index) => {
					const layout = layouts[item.block.acf_fc_layout];
					const hasError = errorsUnder(errors, `blocks[${index}]`).length > 0;
					const classes = ["cinq-blocks__item"];

					if (item.uid === selected) classes.push("is-selected");
					if (index === hovered) classes.push("is-hovered");
					if (index === dragging) classes.push("is-dragging");
					if (over === index && dragging !== null && dragging !== index) classes.push(dragging < index ? "is-over-after" : "is-over-before");
					if (hasError) classes.push("has-error");

					return h(
						"li",
						{
							key: item.uid,
							className: classes.join(" "),
							draggable: true,
							onDragStart: (event) => {
								event.dataTransfer.effectAllowed = "move";
								event.dataTransfer.setData("text/plain", String(index));
								setDragging(index);
							},
							onDragOver: (event) => {
								event.preventDefault();
								setOver(index);
							},
							onDrop: (event) => {
								event.preventDefault();
								if (dragging !== null && dragging !== index) {
									onMove(dragging, index);
								}
								setDragging(null);
								setOver(null);
							},
							onDragEnd: () => {
								setDragging(null);
								setOver(null);
							},
							onMouseEnter: () => onHover(index),
							onMouseLeave: () => onHover(null),
						},
						h("span", { className: "cinq-blocks__grip", "aria-hidden": true }, "⋮⋮"),
						h(
							"button",
							{ type: "button", className: "cinq-blocks__select", onClick: () => onSelect(item.uid), "aria-current": item.uid === selected ? "true" : undefined },
							h("span", { className: "cinq-blocks__label" }, layout ? layout.label : item.block.acf_fc_layout),
							h("span", { className: "cinq-blocks__summary" }, summaryOf(item.block) || " ")
						),
						h(
							"span",
							{ className: "cinq-blocks__actions" },
							h(Button, { icon: "arrow-up-alt2", size: "small", label: "Monter", disabled: index === 0, onClick: () => onMove(index, index - 1) }),
							h(Button, { icon: "arrow-down-alt2", size: "small", label: "Descendre", disabled: index === items.length - 1, onClick: () => onMove(index, index + 1) }),
							h(Button, { icon: "admin-page", size: "small", label: "Dupliquer", onClick: () => onDuplicate(index) }),
							h(Button, { icon: "trash", size: "small", label: "Supprimer", isDestructive: true, onClick: () => onRemove(index) })
						)
					);
				})
			),
			h("div", { className: "cinq-blocks__add" }, h(Button, { variant: "secondary", icon: "plus", onClick: onAdd }, "Ajouter un bloc"))
		);
	}

	function Inspector({ item, index, layout, errors, onChange }) {
		if (!item) {
			return h(
				"aside",
				{ className: "cinq-panel cinq-inspector is-empty", "aria-label": "Réglages du bloc" },
				h("p", null, "Sélectionnez un bloc, dans la liste ou directement sur la page, pour modifier son contenu.")
			);
		}

		const path = `blocks[${index}]`;
		const own = errorsAt(errors, path);

		if (!layout) {
			return h(
				"aside",
				{ className: "cinq-panel cinq-inspector" },
				h(Notice, { status: "warning", isDismissible: false }, `Le type de bloc « ${item.block.acf_fc_layout} » n’existe plus dans le thème.`)
			);
		}

		const values = item.block;
		const setField = (name, next) => onChange({ ...values, [name]: next });

		return h(
			"aside",
			{ className: "cinq-panel cinq-inspector", "aria-label": `Réglages du bloc ${layout.label}` },
			h(
				"header",
				{ className: "cinq-inspector__head" },
				h("h2", { className: "cinq-panel__title" }, layout.label),
				layout.description && h("p", { className: "cinq-help" }, layout.description),
				layout.guidance && h("p", { className: "cinq-guidance" }, layout.guidance)
			),
			own.map((message, position) => h(Notice, { key: position, status: "error", isDismissible: false }, message)),
			// One panel per top-level field, in the theme's order: a group
			// shows its fields, anything else (a repeater) shows itself.
			layout.fields
				.filter((field) => isVisible(field, layout.fields, values))
				.map((field, position) =>
					h(
						PanelBody,
						{
							key: `${item.uid}-${field.key || field.name}`,
							title: h(
								Fragment,
								null,
								field.label,
								errorsUnder(errors, `${path}.${field.name}`).length ? h("span", { className: "cinq-dot", "aria-label": "Erreur" }) : null
							),
							initialOpen: field.name !== "layout" && position < 2,
						},
						field.type === "group"
							? h(
									Fragment,
									null,
									field.instructions && h("p", { className: "cinq-help" }, field.instructions),
									h(Fields, {
										fields: field.sub_fields,
										value: values[field.name],
										onChange: (next) => setField(field.name, next),
										path: `${path}.${field.name}`,
										errors,
									})
							  )
							: h(Field, {
									field,
									value: values[field.name],
									onChange: (next) => setField(field.name, next),
									path: `${path}.${field.name}`,
									errors,
							  })
					)
				)
		);
	}

	function BlockPicker({ layouts, onPick, onClose }) {
		const [query, setQuery] = useState("");
		const needle = query.trim().toLowerCase();
		const offered = layouts.filter((layout) => layout.offered && (!needle || `${layout.label} ${layout.description}`.toLowerCase().includes(needle)));

		return h(
			Modal,
			{ title: "Ajouter un bloc", onRequestClose: onClose, className: "cinq-picker", size: "large" },
			h(SearchControl, { value: query, onChange: setQuery, placeholder: "Rechercher un bloc…", __nextHasNoMarginBottom: true }),
			h(
				"ul",
				{ className: "cinq-picker__list" },
				offered.map((layout) =>
					h(
						"li",
						{ key: layout.name },
						h(
							"button",
							{ type: "button", className: "cinq-picker__item", onClick: () => onPick(layout.name) },
							h("strong", null, layout.label),
							layout.description && h("span", null, layout.description)
						)
					)
				)
			),
			!offered.length && h("p", null, "Aucun bloc ne correspond.")
		);
	}

	/* ------------------------------------------------------------------ */
	/* App                                                                 */
	/* ------------------------------------------------------------------ */

	function App() {
		const [state, setState] = useState(null);
		const [loadError, setLoadError] = useState(null);
		const [items, setItems] = useState([]);
		const [selected, setSelected] = useState(null);
		const [hovered, setHovered] = useState(null);
		const [errors, setErrors] = useState([]);
		const [confirm, setConfirm] = useState(null);
		const [status, setStatus] = useState("idle");
		const [changed, setChanged] = useState(false);
		const [picker, setPicker] = useState(false);
		const [device, setDevice] = useState("desktop");
		const [notice, setNotice] = useState(null);
		// The template of the page renders no block zone: changes would show nowhere.
		const [unrendered, setUnrendered] = useState(false);

		const frame = useRef(null);
		const itemsRef = useRef(items);
		const timer = useRef(0);
		const inFlight = useRef(false);
		const again = useRef(false);
		const pending = useRef(false);
		const dirty = useRef(new Set());
		const scrollOnSelect = useRef(false);
		const scrollAfterRender = useRef(false);
		const selectedRef = useRef(selected);

		itemsRef.current = items;
		selectedRef.current = selected;

		const layouts = useMemo(() => {
			const byName = {};
			(state ? state.layouts : []).forEach((layout) => (byName[layout.name] = layout));
			return byName;
		}, [state]);

		const labels = items.map((item) => (layouts[item.block.acf_fc_layout] || {}).label || item.block.acf_fc_layout);
		const selectedIndex = items.findIndex((item) => item.uid === selected);
		const labelsRef = useRef(labels);
		const order = items.map((item) => item.uid);

		labelsRef.current = labels;

		// Reads the labels from a ref: a save scheduled several renders ago
		// must still send the current ones.
		const toFrame = (message) => {
			const target = frame.current && frame.current.contentWindow;

			if (target) {
				target.postMessage({ source: "cinq-wp-editor", labels: labelsRef.current, ...message }, ORIGIN);
			}
		};

		/* Load */

		useEffect(() => {
			apiFetch({ path: API })
				.then((data) => {
					const blocks = data.draft || data.published;

					setState(data);
					setItems(blocks.map((block) => ({ uid: uid(), block })));
					setChanged(Boolean(data.draft));

					if (data.draft) {
						setNotice({ status: "info", text: "Vous reprenez votre brouillon : il n’est pas encore publié." });
					}
				})
				.catch((error) => setLoadError(error.message || "Impossible d’ouvrir ce contenu."));
		}, []);

		/* Messages from the preview */

		useEffect(() => {
			const listen = (event) => {
				const data = event.data;

				if (event.origin !== ORIGIN || !data || data.source !== "cinq-wp-editor-preview") {
					return;
				}

				if (data.type === "ready") {
					setUnrendered(data.blocks === false);

					// The preview has no admin color scheme: lend it the editor's.
					toFrame({ type: "theme", rgb: getComputedStyle(document.body).getPropertyValue("--wp-admin-theme-color--rgb").trim() });

					const index = itemsRef.current.findIndex((item) => item.uid === selected);
					toFrame({ type: "order", uids: itemsRef.current.map((item) => item.uid) });
					toFrame({ type: "select", index: index < 0 ? null : index });
				}

				if (data.type === "select") {
					const item = itemsRef.current[data.index];
					scrollOnSelect.current = false;
					setSelected(item ? item.uid : null);
				}

				if (data.type === "hover") {
					setHovered(data.index);
				}
			};

			window.addEventListener("message", listen);
			return () => window.removeEventListener("message", listen);
		});

		useEffect(() => {
			toFrame({ type: "select", index: selectedIndex < 0 ? null : selectedIndex, scroll: scrollOnSelect.current });
			scrollOnSelect.current = false;
		}, [selected, selectedIndex]);

		useEffect(() => {
			toFrame({ type: "labels" });
		}, [labels.join("|")]);

		// Moves and removals show at once: the preview reorders its own
		// blocks, nothing is fetched.
		useEffect(() => {
			toFrame({ type: "order", uids: order });
		}, [order.join(",")]);

		/* Saving */

		/**
		 * Saves the draft and gets back, in the same request, the HTML of the
		 * blocks whose fields changed or that were just added.
		 */
		async function flush() {
			if (inFlight.current) {
				again.current = true;
				return;
			}

			inFlight.current = true;

			const snapshot = itemsRef.current;
			const render = Array.from(dirty.current)
				.map((uidToRender) => snapshot.findIndex((item) => item.uid === uidToRender))
				.filter((index) => index >= 0);

			dirty.current.clear();
			pending.current = false;
			setStatus("saving");

			try {
				const response = await apiFetch({
					path: `${API}/draft`,
					method: "PUT",
					data: { blocks: snapshot.map((item) => item.block), render },
				});
				const html = response.html || {};
				let fallback = false;

				render.forEach((index) => {
					if (html[index]) {
						toFrame({ type: "replace", uid: snapshot[index].uid, html: html[index] });
					} else {
						fallback = true;
					}
				});

				// A block the server could not render alone: the whole page.
				if (fallback) {
					toFrame({ type: "refresh" });
				}

				if (scrollAfterRender.current) {
					const index = snapshot.findIndex((item) => item.uid === selectedRef.current);
					scrollAfterRender.current = false;
					toFrame({ type: "select", index: index < 0 ? null : index, scroll: true });
				}

				setErrors(response.errors || []);
				setStatus("saved");
			} catch (error) {
				setStatus("error");
				setNotice({ status: "error", text: error.message || "Le brouillon n’a pas pu être enregistré." });
			}

			inFlight.current = false;

			if (again.current) {
				again.current = false;
				flush();
			}
		}

		/**
		 * Applies a change, then saves after a pause.
		 *
		 * `renderUid` names a block the preview needs again from the server: one
		 * whose fields changed, or a new one. Moves and removals pass null: the
		 * preview already shows them.
		 */
		function commit(nextItems, renderUid) {
			if (renderUid) {
				dirty.current.add(renderUid);
			}

			pending.current = true;
			itemsRef.current = nextItems;

			setItems(nextItems);
			setChanged(true);
			clearTimeout(timer.current);
			timer.current = setTimeout(flush, SAVE_DELAY);
		}

		useEffect(() => {
			const warn = (event) => {
				if (pending.current || inFlight.current) {
					event.preventDefault();
					event.returnValue = "";
				}
			};

			window.addEventListener("beforeunload", warn);
			return () => window.removeEventListener("beforeunload", warn);
		}, []);

		/* Block operations */

		const updateBlock = (uidToUpdate, block) =>
			commit(
				itemsRef.current.map((item) => (item.uid === uidToUpdate ? { ...item, block } : item)),
				uidToUpdate
			);

		const moveBlock = (from, to) => {
			if (to < 0 || to >= itemsRef.current.length) {
				return;
			}
			const next = itemsRef.current.slice();
			const [item] = next.splice(from, 1);
			next.splice(to, 0, item);
			commit(next, null);
		};

		const removeBlock = (index) => {
			const item = itemsRef.current[index];

			setConfirm({
				title: "Supprimer le bloc ?",
				text: `Le bloc « ${labels[index]} » sera retiré de la page. Vous pourrez encore abandonner le brouillon pour le retrouver.`,
				label: "Supprimer",
				action: () => {
					commit(
						itemsRef.current.filter((other) => other !== item),
						null
					);
					setSelected((current) => (current === item.uid ? null : current));
				},
			});
		};

		const duplicateBlock = (index) => {
			const twin = { uid: uid(), block: copy(itemsRef.current[index].block) };
			const next = itemsRef.current.slice();

			next.splice(index + 1, 0, twin);
			scrollAfterRender.current = true;
			selectedRef.current = twin.uid;
			commit(next, twin.uid);
			setSelected(twin.uid);
		};

		const addBlock = (name) => {
			const layout = layouts[name];
			const fresh = { uid: uid(), block: { acf_fc_layout: name, ...defaultsFor(layout.fields) } };
			const next = itemsRef.current.slice();
			const at = selectedIndex < 0 ? next.length : selectedIndex + 1;

			next.splice(at, 0, fresh);
			scrollAfterRender.current = true;
			selectedRef.current = fresh.uid;
			commit(next, fresh.uid);
			setPicker(false);
			setSelected(fresh.uid);
		};

		const selectFromList = (uidToSelect) => {
			scrollOnSelect.current = true;
			setSelected(uidToSelect);
		};

		/* Publish and discard */

		async function publish() {
			clearTimeout(timer.current);
			setStatus("publishing");
			setNotice(null);

			try {
				const response = await apiFetch({ path: `${API}/publish`, method: "POST", data: { blocks: itemsRef.current.map((item) => item.block) } });

				pending.current = false;
				dirty.current.clear();
				setErrors([]);
				setChanged(false);
				setStatus("idle");
				setState((current) => ({ ...current, published: response.blocks, draft: null }));
				setNotice({ status: "success", text: state.post.status === "publish" ? "Publié : la page en ligne est à jour." : "Enregistré." });
			} catch (error) {
				setStatus("error");
				setErrors((error.data && error.data.errors) || []);
				setNotice({ status: "error", text: error.message || "La publication a échoué." });
			}
		}

		function discard() {
			setConfirm({
				title: "Abandonner le brouillon ?",
				text: "Vos modifications non publiées seront perdues : la page revient à sa version publiée.",
				label: "Abandonner",
				action: dropDraft,
			});
		}

		async function dropDraft() {
			clearTimeout(timer.current);
			pending.current = false;
			dirty.current.clear();

			try {
				await apiFetch({ path: `${API}/draft`, method: "DELETE" });
				setItems(state.published.map((block) => ({ uid: uid(), block })));
				setSelected(null);
				setErrors([]);
				setChanged(false);
				setStatus("idle");
				setNotice(null);
				frame.current.contentWindow.location.reload();
			} catch (error) {
				setNotice({ status: "error", text: error.message || "Le brouillon n’a pas pu être abandonné." });
			}
		}

		/* Render */

		if (loadError) {
			return h("div", { className: "cinq-wp-editor__fatal" }, h(Notice, { status: "error", isDismissible: false }, loadError));
		}

		if (!state) {
			return h("div", { className: "cinq-wp-editor__loading" }, h(Spinner));
		}

		const statusText = {
			idle: changed ? "Modifications non publiées" : "À jour",
			saving: "Enregistrement du brouillon…",
			saved: changed ? "Brouillon enregistré" : "À jour",
			publishing: "Publication…",
			error: "Erreur",
		}[status];

		const isPublished = state.post.status === "publish";

		return h(
			Fragment,
			null,
			h(
				"header",
				{ className: "cinq-topbar" },
				h(
					"div",
					{ className: "cinq-topbar__start" },
					h(Button, { icon: "arrow-left-alt2", label: "Retour à la liste", href: state.post.listUrl }),
					h("div", null, h("strong", { className: "cinq-topbar__title" }, state.post.title || "(sans titre)"), h("span", { className: "cinq-topbar__type" }, state.post.typeLabel))
				),
				h(
					"div",
					{ className: "cinq-topbar__devices", role: "group", "aria-label": "Largeur de l’aperçu" },
					h(Button, { icon: "desktop", label: "Ordinateur", isPressed: device === "desktop", onClick: () => setDevice("desktop") }),
					h(Button, { icon: "smartphone", label: "Mobile", isPressed: device === "mobile", onClick: () => setDevice("mobile") })
				),
				h(
					"div",
					{ className: "cinq-topbar__end" },
					h("span", { className: `cinq-status is-${status}` }, status === "saving" || status === "publishing" ? h(Spinner) : null, statusText),
					h(Button, { variant: "tertiary", href: state.post.editUrl }, "Éditeur classique"),
					changed && h(Button, { variant: "tertiary", isDestructive: true, onClick: discard, disabled: status === "publishing" }, "Abandonner"),
					h(
						Button,
						{ variant: "primary", onClick: publish, disabled: !changed || status === "publishing" || status === "saving", isBusy: status === "publishing" },
						isPublished ? "Publier" : "Enregistrer"
					)
				)
			),
			(notice || unrendered) &&
				h(
					"div",
					{ className: "cinq-notice" },
					unrendered &&
						h(
							Notice,
							{ status: "warning", isDismissible: false, actions: [{ label: "Modifier dans l’éditeur classique", url: state.post.editUrl }] },
							"Le gabarit de cette page n’affiche pas ses blocs : vos modifications ne s’y verront pas."
						),
					notice &&
						h(Notice, { status: notice.status, onRemove: () => setNotice(null) }, notice.text, errors.length && notice.status === "error" ? ` (${errors.length} champ${errors.length > 1 ? "s" : ""} à corriger)` : "")
				),
			h(BlockList, {
				items,
				layouts,
				selected,
				hovered,
				errors,
				onSelect: selectFromList,
				onHover: (index) => toFrame({ type: "hover", index }),
				onMove: moveBlock,
				onRemove: removeBlock,
				onDuplicate: duplicateBlock,
				onAdd: () => setPicker(true),
			}),
			h(
				"main",
				{ className: `cinq-stage is-${device}` },
				h("iframe", { ref: frame, className: "cinq-stage__frame", src: state.post.previewUrl, title: "Aperçu de la page" })
			),
			h(Inspector, {
				item: items[selectedIndex],
				index: selectedIndex,
				layout: selectedIndex < 0 ? null : layouts[items[selectedIndex].block.acf_fc_layout],
				errors,
				onChange: (block) => updateBlock(items[selectedIndex].uid, block),
			}),
			picker && h(BlockPicker, { layouts: state.layouts, onPick: addBlock, onClose: () => setPicker(false) }),
			confirm &&
				h(Confirm, {
					...confirm,
					onConfirm: () => {
						setConfirm(null);
						confirm.action();
					},
					onCancel: () => setConfirm(null),
				})
		);
	}

	const root = document.getElementById("cinq-wp-editor");

	if (root) {
		createRoot(root).render(h(App));
	}
})(window.wp, window.cinqWpEditor);
