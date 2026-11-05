/**
 * CINQ Éditeur.
 *
 * Three columns: the blocks of the page on the left, the real page in the
 * middle, the fields of the selected block on the right. Every change is saved
 * as the user's draft after a short pause, then the preview fetches the page
 * again and swaps the changed block in.
 *
 * Built with @wordpress/scripts, as WordPress's own screens are: the
 * @wordpress packages are WordPress's scripts, loaded by handle; only
 * @wordpress/icons, which WordPress does not ship as a script, is bundled.
 */
import apiFetch from "@wordpress/api-fetch";
import { LinkControl, store as blockEditorStore } from "@wordpress/block-editor";
import { useCommand } from "@wordpress/commands";
import {
	BaseControl,
	Button,
	CheckboxControl,
	ColorIndicator,
	ColorPicker,
	DatePicker,
	DateTimePicker,
	Dropdown,
	DropdownMenu,
	MenuGroup,
	MenuItem,
	MenuItemsChoice,
	Modal,
	Notice,
	NoticeList,
	PanelBody,
	SearchControl,
	SelectControl,
	SnackbarList,
	Spinner,
	TabPanel,
	TextControl,
	TextareaControl,
	TimePicker,
	ToggleControl,
} from "@wordpress/components";
import { __experimentalFetchLinkSuggestions as fetchLinkSuggestions } from "@wordpress/core-data";
import { dispatch, useDispatch, useSelect } from "@wordpress/data";
import { getSettings as getDateSettings, gmdateI18n } from "@wordpress/date";
import { createElement as h, createRoot, Fragment, useEffect, useMemo, useRef, useState } from "@wordpress/element";
import {
	Icon,
	arrowLeft,
	closeSmall,
	desktop,
	dragHandle,
	drawerRight,
	external,
	link as linkIcon,
	listView,
	mobile,
	moreVertical,
	pencil,
	plus,
	tablet,
	undo,
	upload,
} from "@wordpress/icons";
import { store as keyboardShortcutsStore, useShortcut } from "@wordpress/keyboard-shortcuts";
import { store as noticesStore } from "@wordpress/notices";
import { addQueryArgs } from "@wordpress/url";

const config = window.cinqWpEditor;

// WordPress APIs that are no packages: the media library, the heartbeat and
// the classic editor, `wp.editor` until the block editor takes the name.
const { media, heartbeat } = window.wp;
const classicEditor = window.wp.oldEditor || window.wp.editor;

// LinkControl searches through the block editor's settings: given the
// search the post editor gives it, WordPress's own over posts and terms.
dispatch(blockEditorStore).updateSettings({
	__experimentalFetchLinkSuggestions: (search, options) => fetchLinkSuggestions(search, options, {}),
});

const SAVE_DELAY = 300;
const ORIGIN = window.location.origin;
const API = `/${config.namespace}/posts/${config.postId}`;

// The editor's notices, apart from any other screen's, in WordPress's own store.
const NOTICES = "cinq-wp-editor";

// Preview widths, as the block editor offers them.
const DEVICES = [
	{ value: "desktop", label: "Ordinateur", icon: desktop },
	{ value: "tablet", label: "Tablette", icon: tablet },
	{ value: "mobile", label: "Mobile", icon: mobile },
];

/**
 * Hands ⌘S / Ctrl+S typed in a frame (TinyMCE, the preview) to the
 * document, where the editor's shortcut listens.
 */
const forwardSave = (event) => {
	if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s") {
		event.preventDefault();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: event.metaKey, ctrlKey: event.ctrlKey, bubbles: true }));
	}
};

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

		// A default that is an object, such as the icon picker's empty
		// `{ type, value }`, is no value to send.
		default:
			return fallback === undefined || fallback === null || fallback === "" || typeof fallback === "object" ? undefined : fallback;
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

		case "date_picker":
		case "date_time_picker":
		case "time_picker":
			control = h(DateField, { field, label, help, value, onChange });
			break;

		case "text":
		case "email":
		case "url":
		case "password":
		case "oembed":
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
			control = h(ColorField, { field, label, help, value, onChange });
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
			control = h(LinkField, { field, label, help, value, onChange });
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
		case "page_link":
			control = h(PostField, { field, label, help, value, onChange });
			break;

		case "user":
			control = h(UserField, { field, label, help, value, onChange });
			break;

		case "icon_picker":
			control = h(IconField, { field, label, help, value, onChange });
			break;

		case "google_map":
			control = h(MapField, { field, label, help, value, onChange });
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

/**
 * Dates as ACF stores them: `Ymd` for a date, `Y-m-d H:i:s` for a date and
 * time, `H:i:s` for a time. WordPress's pickers read and write ISO strings.
 */
const DATE_KINDS = {
	date_picker: {
		picker: DatePicker,
		toIso: (value) => (/^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00` : null),
		fromIso: (iso) => iso.slice(0, 10).replaceAll("-", ""),
		format: (formats) => formats.date,
	},
	date_time_picker: {
		picker: DateTimePicker,
		toIso: (value) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value) ? value.replace(" ", "T") : null),
		fromIso: (iso) => iso.slice(0, 19).replace("T", " "),
		format: (formats) => `${formats.date} ${formats.time}`,
	},
	time_picker: {
		picker: TimePicker,
		toIso: (value) => (/^\d{2}:\d{2}(:\d{2})?$/.test(value) ? `1970-01-01T${value}` : null),
		fromIso: (iso) => iso.slice(11, 19),
		format: (formats) => formats.time,
	},
};

/**
 * A date, time or both, as the block editor sets a post's date: a button
 * showing the value in the field's display format, opening the picker.
 */
function DateField({ field, label, help, value, onChange }) {
	const kind = DATE_KINDS[field.type];
	const settings = getDateSettings();
	const iso = kind.toIso(String(value ?? ""));
	// The block editor's own test for a 12-hour site format.
	const is12Hour = /a(?!\\)/i.test(settings.formats.time.toLowerCase().replace(/\\\\/g, "").split("").reverse().join(""));
	// Wall-clock values: formatted as UTC so no time zone shifts them.
	const shown = iso ? gmdateI18n(field.display_format || kind.format(settings.formats), `${iso}Z`) : "";
	const pickerProps =
		field.type === "time_picker"
			? { currentTime: iso, is12Hour }
			: { currentDate: iso, is12Hour, startOfWeek: field.first_day === undefined ? settings.l10n.startOfWeek : Number(field.first_day) };

	return h(
		"div",
		{ className: "components-base-control cinq-date" },
		h(BaseControl.VisualLabel, null, label),
		h(Dropdown, {
			popoverProps: { placement: "left-start" },
			renderToggle: ({ isOpen, onToggle }) =>
				h(Button, { variant: "secondary", onClick: onToggle, "aria-expanded": isOpen, "aria-label": `${field.label} : ${shown || "aucune valeur"}` }, shown || "Choisir…"),
			renderContent: ({ onClose }) =>
				h(
					"div",
					{ className: "cinq-date__picker" },
					h(kind.picker, { ...pickerProps, onChange: (next) => onChange(kind.fromIso(next)) }),
					!Number(field.required) &&
						value &&
						h(
							Button,
							{
								variant: "tertiary",
								isDestructive: true,
								onClick: () => {
									onChange("");
									onClose();
								},
							},
							"Effacer"
						)
				),
		}),
		help && h("p", { className: "components-base-control__help" }, help)
	);
}

/**
 * `#rrggbbaa` from WordPress's picker, as ACF stores a colour with
 * opacity: `rgba(r,g,b,a)`.
 */
const toRgba = (hex) => {
	const [red, green, blue, alpha] = [1, 3, 5, 7].map((start) => parseInt(hex.slice(start, start + 2), 16));

	return `rgba(${red},${green},${blue},${Number((alpha / 255).toFixed(2))})`;
};

/**
 * A colour, as the block editor picks one: a swatch and its value,
 * opening WordPress's colour picker.
 */
function ColorField({ field, label, help, value, onChange }) {
	const alpha = Boolean(Number(field.enable_opacity));
	const color = typeof value === "string" ? value : "";

	return h(
		"div",
		{ className: "components-base-control cinq-color" },
		h(BaseControl.VisualLabel, null, label),
		h(Dropdown, {
			popoverProps: { placement: "left-start" },
			renderToggle: ({ isOpen, onToggle }) =>
				h(
					Button,
					{ variant: "secondary", className: "cinq-color__toggle", onClick: onToggle, "aria-expanded": isOpen, "aria-label": `${field.label} : ${color || "aucune couleur"}` },
					h(ColorIndicator, { colorValue: color || "transparent" }),
					color || "Choisir…"
				),
			renderContent: ({ onClose }) =>
				h(
					"div",
					{ className: "cinq-color__picker" },
					h(ColorPicker, {
						color: color || undefined,
						enableAlpha: alpha,
						onChange: (next) => onChange(alpha && next.length === 9 ? toRgba(next) : next),
					}),
					!Number(field.required) &&
						color &&
						h(
							Button,
							{
								variant: "tertiary",
								isDestructive: true,
								onClick: () => {
									onChange("");
									onClose();
								},
							},
							"Effacer"
						)
				),
		}),
		help && h("p", { className: "components-base-control__help" }, help)
	);
}

/**
 * The post is locked by someone else, as the block editor says it: who
 * holds it, and the way back or the way in. Nothing behind can be used.
 */
function LockedModal({ lock, post }) {
	const takeOver = !lock.takenOver && lock.canTakeOver;

	return h(
		Modal,
		{
			title: lock.takenOver ? "Quelqu’un d’autre a pris le contrôle" : "Ce contenu est déjà en cours de modification",
			className: "cinq-lock",
			isDismissible: false,
			shouldCloseOnEsc: false,
			shouldCloseOnClickOutside: false,
			onRequestClose: () => {},
		},
		h(
			"div",
			{ className: "cinq-lock__body" },
			lock.avatar && h("img", { className: "cinq-lock__avatar", src: lock.avatar, alt: "", width: 64, height: 64 }),
			h(
				"div",
				null,
				h("p", null, lock.text),
				lock.takenOver && h("p", null, "Vos modifications non publiées restent dans votre brouillon : vous les retrouverez en rouvrant la page.")
			)
		),
		h(
			"div",
			{ className: "cinq-confirm__actions" },
			h(Button, { variant: takeOver ? "secondary" : "primary", href: post.listUrl }, "Revenir à la liste"),
			takeOver && h(Button, { variant: "primary", href: lock.takeOverUrl }, "Prendre le contrôle")
		)
	);
}

/**
 * The « Options » menu of a block or a row, as the block editor's list
 * view has one: an action missing from the props is left out, one passed
 * as null is shown disabled.
 */
function RowMenu({ label, onDuplicate, onUp, onDown, onRemove }) {
	const item = (text, action, extra = {}) =>
		action === undefined
			? null
			: h(MenuItem, { ...extra, disabled: action === null, onClick: action ? () => action() : undefined }, text);

	return h(
		DropdownMenu,
		{ icon: moreVertical, label: `Options : ${label}`, toggleProps: { size: "small" }, popoverProps: { placement: "bottom-end" } },
		({ onClose }) => {
			const then = (action) =>
				action
					? () => {
							onClose();
							action();
						}
					: action;

			return h(
				Fragment,
				null,
				h(MenuGroup, null, item("Dupliquer", then(onDuplicate)), item("Monter", then(onUp)), item("Descendre", then(onDown))),
				h(MenuGroup, null, item("Supprimer", then(onRemove), { isDestructive: true }))
			);
		}
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
							setup: (editor) => {
								editor.on("input change undo redo ExecCommand", emit);
								editor.on("keydown", forwardSave);
							},
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

/**
 * A link, as the block editor edits one: its LinkControl, in a popover
 * opened from a button showing the link. Search, direct entry, the link
 * text and « Ouvrir dans un nouvel onglet » are WordPress's own. ACF stores
 * `{ title, url, target }`.
 */
function LinkField({ field, label, help, value, onChange }) {
	const link = value && typeof value === "object" && value.url ? value : null;
	const current = link ? { url: link.url, title: link.title || "", opensInNewTab: link.target === "_blank" } : undefined;
	const save = (next) => onChange({ title: next.title || "", url: next.url || "", target: next.opensInNewTab ? "_blank" : "" });
	const shown = link ? link.title || link.url : "";

	return h(
		"div",
		{ className: "components-base-control cinq-link" },
		h(BaseControl.VisualLabel, null, label),
		h(Dropdown, {
			popoverProps: { placement: "left-start" },
			renderToggle: ({ isOpen, onToggle }) =>
				h(
					Button,
					{ variant: "secondary", className: "cinq-link__toggle", icon: linkIcon, onClick: onToggle, "aria-expanded": isOpen, "aria-label": `${field.label} : ${shown || "aucun lien"}` },
					shown || "Ajouter un lien"
				),
			renderContent: ({ onClose }) =>
				h(LinkControl, {
					value: current,
					onChange: save,
					onRemove: () => {
						onChange("");
						onClose();
					},
					hasTextControl: true,
					forceIsEditingLink: !link,
					withCreateSuggestion: false,
				}),
		}),
		link && link.title && h("p", { className: "components-base-control__help cinq-link__url" }, link.url),
		help && h("p", { className: "components-base-control__help" }, help)
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
		const model = media.attachment(id);

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
	const frame = media({
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
	// ACF checks the maximum in its interface only, not when saving.
	const max = Number(field.max) || 0;
	const full = max > 0 && ids.length >= max;

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
					h(Button, { icon: closeSmall, size: "small", label: "Retirer", onClick: () => onChange(ids.filter((item) => item !== id)) })
				)
			)
		),
		h(
			Button,
			{ variant: "secondary", size: "compact", disabled: full, onClick: () => openMediaFrame(field, true, (picked) => onChange([...ids, ...picked].slice(0, max || undefined))) },
			"Ajouter des images"
		),
		full && h("p", { className: "cinq-help" }, `${max} image${max > 1 ? "s" : ""} au plus.`),
		help && h("p", { className: "cinq-help" }, help)
	);
}

/**
 * Picks references: contents, users or archives. Selected ones are listed
 * by title, a search finds more. `lookup` names the selected IDs it does
 * not know yet, `search` finds candidates, `extra` are fixed options shown
 * before any search, such as a page link's archives.
 */
function ReferenceField({ label, help, multiple, value, onChange, lookup, search, extra = [], placeholder, empty }) {
	// IDs come back from ACF as strings; archive links are URLs.
	const normalize = (item) => (/^\d+$/.test(String(item)) ? Number(item) : String(item));
	const ids = toArray(value).map(normalize).filter(Boolean);
	const [titles, setTitles] = useState(() => Object.fromEntries(extra.map((item) => [item.id, item.title])));
	const [query, setQuery] = useState("");
	const [results, setResults] = useState([]);

	useEffect(() => {
		const missing = ids.filter((id) => typeof id === "number" && !(id in titles));

		if (!missing.length) {
			return;
		}

		lookup(missing)
			.then((list) => setTitles((known) => ({ ...known, ...Object.fromEntries(list.map((item) => [item.id, item.title])) })))
			.catch(() => {});
	}, [ids.join(",")]);

	useEffect(() => {
		const term = query.trim().toLowerCase();

		if (term.length < 2) {
			setResults([]);
			return;
		}

		const timer = setTimeout(() => {
			const fixed = extra.filter((item) => item.title.toLowerCase().includes(term));

			search(query)
				.then((list) => setResults([...fixed, ...list]))
				.catch(() => setResults(fixed));
		}, 250);

		return () => clearTimeout(timer);
	}, [query]);

	const set = (next) => onChange(multiple ? next : next.length ? next[next.length - 1] : "");
	const shown = (query.trim().length < 2 ? extra : results).filter((item) => !ids.includes(item.id));

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
							h("span", null, titles[id] || (typeof id === "number" ? `#${id}` : id)),
							h(Button, { icon: closeSmall, size: "small", label: "Retirer", onClick: () => set(ids.filter((item) => item !== id)) })
						)
					)
			  )
			: h("p", { className: "cinq-help" }, empty),
		h(SearchControl, { value: query, onChange: setQuery, placeholder, __nextHasNoMarginBottom: true }),
		shown.length
			? h(
					"ul",
					{ className: "cinq-posts__results" },
					shown.map((item) =>
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

/**
 * Contents, through WordPress's search route: post objects, relationships
 * and page links, whose archives come as fixed options.
 */
function PostField({ field, label, help, value, onChange }) {
	const subtype = Array.isArray(field.post_type) && field.post_type.length ? field.post_type.join(",") : "any";
	const find = (args) => apiFetch({ path: addQueryArgs("/wp/v2/search", { type: "post", subtype, ...args }) });

	return h(ReferenceField, {
		label,
		help,
		value,
		onChange,
		multiple: field.type === "relationship" || Boolean(Number(field.multiple)),
		lookup: (ids) => find({ include: ids.join(","), per_page: ids.length }),
		search: (query) => find({ search: query, per_page: 8 }),
		extra: field.archives || [],
		placeholder: "Rechercher un contenu…",
		empty: "Aucun contenu choisi.",
	});
}

/**
 * Users, through the editor's own route: ACF's search, among the roles the
 * field allows.
 */
function UserField({ field, label, help, value, onChange }) {
	const find = (args) => apiFetch({ path: addQueryArgs(`${API}/users`, { field: field.key, ...args }) });

	return h(ReferenceField, {
		label,
		help,
		value,
		onChange,
		multiple: Boolean(Number(field.multiple)),
		lookup: (ids) => find({ include: ids }),
		search: (query) => find({ search: query }),
		placeholder: "Rechercher un utilisateur…",
		empty: "Aucun utilisateur choisi.",
	});
}

/**
 * An icon, as ACF's icon picker stores it: `{ type, value }`, a Dashicon
 * class, an attachment ID or a URL. One tab per kind the field allows.
 */
function IconField({ field, label, help, value, onChange }) {
	const tabs = field.icon_tabs || [];
	const icon = value && typeof value === "object" && value.type ? value : null;
	const [query, setQuery] = useState("");
	const set = (type, next) => onChange(next === "" || next === null ? "" : { type, value: next });

	if (!tabs.length) {
		return h("p", { className: "cinq-help" }, `${field.label} : aucun onglet de ce champ n’est disponible ici.`);
	}

	const term = query.trim().toLowerCase();
	const dashicons = Object.entries(config.dashicons || {}).filter(([name, text]) => !term || name.includes(term) || text.toLowerCase().includes(term));

	const panels = {
		dashicons: () =>
			h(
				Fragment,
				null,
				h(SearchControl, { value: query, onChange: setQuery, placeholder: "Rechercher une icône…", __nextHasNoMarginBottom: true }),
				h(
					"div",
					{ className: "cinq-icons", role: "list" },
					dashicons.map(([name, text]) =>
						h(Button, {
							key: name,
							role: "listitem",
							icon: name.replace(/^dashicons-/, ""),
							label: text,
							isPressed: Boolean(icon && icon.type === "dashicons" && icon.value === name),
							onClick: () => set("dashicons", name),
						})
					)
				)
			),
		media_library: () =>
			h(MediaField, {
				field: { ...field, type: "image" },
				label: "Image",
				value: icon && icon.type === "media_library" ? icon.value : "",
				onChange: (id) => set("media_library", id),
			}),
		url: () =>
			h(TextControl, {
				label: "Adresse de l’image",
				type: "url",
				value: icon && icon.type === "url" ? icon.value : "",
				onChange: (url) => set("url", url),
				__nextHasNoMarginBottom: true,
			}),
	};

	return h(
		"div",
		{ className: "components-base-control cinq-icon" },
		h(BaseControl.VisualLabel, null, label),
		h(
			TabPanel,
			{
				className: "cinq-icon__tabs",
				initialTabName: icon && tabs.some((tab) => tab.name === icon.type) ? icon.type : tabs[0].name,
				tabs: tabs.map((tab) => ({ name: tab.name, title: tab.label })),
			},
			(tab) => h("div", { className: "cinq-icon__panel" }, panels[tab.name]())
		),
		icon &&
			!Number(field.required) &&
			h(Button, { variant: "tertiary", isDestructive: true, size: "compact", onClick: () => onChange("") }, "Retirer l’icône"),
		help && h("p", { className: "components-base-control__help" }, help)
	);
}

/**
 * A place, as ACF's Google Map field stores it: an address and its
 * coordinates. ACF draws a Google map only with an API key; the fields are
 * the same either way, and a link shows the place on Google Maps.
 */
function MapField({ field, label, help, value, onChange }) {
	const place = value && typeof value === "object" ? value : {};
	const set = (key, next) => {
		const updated = { ...place, [key]: next };
		const filled = ["address", "lat", "lng"].some((name) => updated[name] !== "" && updated[name] !== undefined && updated[name] !== null);

		onChange(filled ? updated : "");
	};
	const lat = place.lat ?? "";
	const lng = place.lng ?? "";
	const number = (key, text, extra) =>
		h(TextControl, {
			label: text,
			type: "number",
			step: "any",
			value: place[key] ?? "",
			onChange: (next) => set(key, next === "" ? "" : Number(next)),
			__nextHasNoMarginBottom: true,
			...extra,
		});

	return h(
		"fieldset",
		{ className: "cinq-group cinq-map" },
		h("legend", null, label),
		help && h("p", { className: "cinq-help" }, help),
		h(TextControl, { label: "Adresse", value: place.address ?? "", onChange: (next) => set("address", next), __nextHasNoMarginBottom: true }),
		h(
			"div",
			{ className: "cinq-map__coords" },
			number("lat", "Latitude", { placeholder: field.center_lat || undefined }),
			number("lng", "Longitude", { placeholder: field.center_lng || undefined })
		),
		number("zoom", "Zoom", { min: 1, max: 21, step: 1, placeholder: field.zoom || undefined }),
		lat !== "" && lng !== "" && h(Button, { variant: "link", href: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, target: "_blank" }, "Voir sur Google Maps")
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
	const duplicate = (index) => {
		const next = rows.slice();
		next.splice(index + 1, 0, copy(rows[index]));
		onChange(next);
		setOpen(index + 1);
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
						h(RowMenu, {
							label: `élément ${index + 1}`,
							onDuplicate: max > 0 && rows.length >= max ? null : () => duplicate(index),
							onUp: index === 0 ? null : () => move(index, -1),
							onDown: index === rows.length - 1 ? null : () => move(index, 1),
							onRemove: rows.length <= min ? null : () => remove(index),
						})
					),
					open === index && h("div", { className: "cinq-repeater__body" }, h(Fields, { fields: field.sub_fields, value: row, onChange: (next) => update(index, next), path: rowPath, errors }))
				);
			})
		),
		h(Button, { variant: "secondary", size: "compact", icon: plus, disabled: max > 0 && rows.length >= max, onClick: add }, field.button_label || "Ajouter un élément"),
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
		{ id: "cinq-wp-editor-blocks", className: "cinq-panel cinq-blocks", "aria-label": "Blocs de la page" },
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
					h("span", { className: "cinq-blocks__grip", "aria-hidden": true }, h(Icon, { icon: dragHandle, size: 24 })),
					h(
						"button",
						{ type: "button", className: "cinq-blocks__select", onClick: () => onSelect(item.uid), "aria-current": item.uid === selected ? "true" : undefined },
						h("span", { className: "cinq-blocks__label" }, layout ? layout.label : item.block.acf_fc_layout),
						h("span", { className: "cinq-blocks__summary" }, summaryOf(item.block) || " ")
					),
					h(
						"span",
						{ className: "cinq-blocks__actions" },
						h(RowMenu, {
							label: layout ? layout.label : item.block.acf_fc_layout,
							onDuplicate: () => onDuplicate(index),
							onUp: index === 0 ? null : () => onMove(index, index - 1),
							onDown: index === items.length - 1 ? null : () => onMove(index, index + 1),
							onRemove: () => onRemove(index),
						})
					)
				);
			})
		),
		h("div", { className: "cinq-blocks__add" }, h(Button, { variant: "secondary", icon: plus, onClick: onAdd }, "Ajouter un bloc"))
	);
}

function Inspector({ item, index, layout, errors, onChange }) {
	if (!item) {
		return h(
			"aside",
			{ id: "cinq-wp-editor-inspector", className: "cinq-panel cinq-inspector is-empty", "aria-label": "Réglages du bloc" },
			h("p", null, "Sélectionnez un bloc, dans la liste ou directement sur la page, pour modifier son contenu.")
		);
	}

	const path = `blocks[${index}]`;
	const own = errorsAt(errors, path);

	if (!layout) {
		return h(
			"aside",
			{ id: "cinq-wp-editor-inspector", className: "cinq-panel cinq-inspector" },
			h(Notice, { status: "warning", isDismissible: false }, `Le type de bloc « ${item.block.acf_fc_layout} » n’existe plus dans le thème.`)
		);
	}

	const values = item.block;
	const setField = (name, next) => onChange({ ...values, [name]: next });

	return h(
		"aside",
		{ id: "cinq-wp-editor-inspector", className: "cinq-panel cinq-inspector", "aria-label": `Réglages du bloc ${layout.label}` },
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
	// The side panels, as the block editor lets one close its list view and settings.
	const [blocksOpen, setBlocksOpen] = useState(true);
	const [inspectorOpen, setInspectorOpen] = useState(true);
	const [device, setDevice] = useState("desktop");
	// Notices as the block editor shows them: a banner for what needs
	// attention, a snackbar for what went well. A fixed id per kind makes a
	// new notice replace the previous one instead of piling up.
	const notices = useSelect((select) => select(noticesStore).getNotices(NOTICES), []);
	const { createNotice, removeNotice } = useDispatch(noticesStore);
	const say = (status, content, options) => createNotice(status, content, { context: NOTICES, ...options });
	const forget = (id) => removeNotice(id, NOTICES);

	const frame = useRef(null);
	const itemsRef = useRef(items);
	const timer = useRef(0);
	const inFlight = useRef(false);
	const publishAfterSave = useRef(false);
	// WordPress's post lock: held while the page is open here, or someone else's.
	const lockValue = useRef(config.lock.value);
	const [locked, setLocked] = useState(config.lock.holder ? { ...config.lock.holder, takenOver: false } : null);
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
					say("info", "Vous reprenez votre brouillon : il n’est pas encore publié.", { id: "draft" });
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
				// The template of the page renders no block zone: changes would show nowhere.
				if (data.blocks === false) {
					say("warning", "Le gabarit de cette page n’affiche pas ses blocs : vos modifications ne s’y verront pas.", {
						id: "unrendered",
						isDismissible: false,
						actions: [{ label: "Modifier dans l’éditeur classique", url: state.post.editUrl }],
					});
				} else {
					forget("unrendered");
				}

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

			if (data.type === "save") {
				requestPublish();
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
			forget("save");
		} catch (error) {
			setStatus("error");
			say("error", error.message || "Le brouillon n’a pas pu être enregistré.", { id: "save" });
		}

		inFlight.current = false;

		// ⌘S during a save: publish once it is done, with what is there now.
		if (publishAfterSave.current) {
			publishAfterSave.current = false;
			again.current = false;
			publish();
			return;
		}

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

	/**
	 * Publishes, or waits for the draft being saved: publishing alongside
	 * it could see the draft written again once published.
	 */
	function requestPublish() {
		if (!changed || status === "publishing" || locked) {
			return;
		}

		if (inFlight.current) {
			publishAfterSave.current = true;
			return;
		}

		publish();
	}

	async function publish() {
		// Changes not saved yet were not rendered either: the page, after.
		const stale = dirty.current.size > 0;

		clearTimeout(timer.current);
		setStatus("publishing");
		forget("publish");

		try {
			const response = await apiFetch({ path: `${API}/publish`, method: "POST", data: { blocks: itemsRef.current.map((item) => item.block) } });

			pending.current = false;
			dirty.current.clear();
			setErrors([]);
			setChanged(false);
			setStatus("idle");
			setState((current) => ({ ...current, published: response.blocks, draft: null }));

			if (stale) {
				toFrame({ type: "refresh" });
			}
			const live = state.post.status === "publish";

			forget("draft");
			say("success", live ? "Page publiée : la page en ligne est à jour." : "Page enregistrée.", {
				id: "publish",
				type: "snackbar",
				actions: live ? [{ label: "Voir la page", url: state.post.viewUrl }] : [],
			});
		} catch (error) {
			const invalid = (error.data && error.data.errors) || [];
			const first = invalid.length ? /^blocks\[(\d+)\]/.exec(invalid[0].path) : null;
			const item = first ? itemsRef.current[Number(first[1])] : null;
			const count = invalid.length ? ` (${invalid.length} champ${invalid.length > 1 ? "s" : ""} à corriger)` : "";

			setStatus("error");
			setErrors(invalid);
			say("error", (error.message || "La publication a échoué.") + count, {
				id: "publish",
				actions: item ? [{ label: "Voir le premier", onClick: () => selectFromList(item.uid) }] : [],
			});
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
			["draft", "save", "publish"].forEach(forget);
			say("info", "Brouillon abandonné : la page est revenue à sa version publiée.", { id: "discard", type: "snackbar" });
			frame.current.contentWindow.location.reload();
		} catch (error) {
			say("error", error.message || "Le brouillon n’a pas pu être abandonné.", { id: "discard" });
		}
	}

	/* Post lock */

	/**
	 * Keeps the lock with the edit screen's own heartbeat: every ten
	 * seconds the lock is renewed, or WordPress says who took it over. On
	 * leaving, the lock is given back as the edit screen gives it back.
	 */
	useEffect(() => {
		const $ = window.jQuery;

		if (!$ || !heartbeat) {
			return;
		}

		heartbeat.interval(10);

		const send = (event, data) => {
			if (lockValue.current) {
				data["wp-refresh-post-lock"] = { post_id: config.postId, lock: lockValue.current };
			}
		};

		const tick = (event, data) => {
			const received = data["wp-refresh-post-lock"];

			if (!received) {
				return;
			}

			if (received.lock_error) {
				lockValue.current = "";
				setLocked({ text: received.lock_error.text, avatar: received.lock_error.avatar_src_2x || received.lock_error.avatar_src || "", takenOver: true });
			} else if (received.new_lock) {
				lockValue.current = received.new_lock;
			}
		};

		const release = () => {
			if (!lockValue.current) {
				return;
			}

			const body = new FormData();

			body.append("action", "wp-remove-post-lock");
			body.append("_wpnonce", config.lock.nonce);
			body.append("post_ID", String(config.postId));
			body.append("active_post_lock", lockValue.current);
			navigator.sendBeacon(config.lock.ajaxUrl, body);
		};

		$(document).on("heartbeat-send.cinq-wp-editor", send).on("heartbeat-tick.cinq-wp-editor", tick);
		window.addEventListener("pagehide", release);

		return () => {
			$(document).off(".cinq-wp-editor");
			window.removeEventListener("pagehide", release);
		};
	}, []);

	/* Shortcuts and commands */

	useEffect(() => {
		dispatch(keyboardShortcutsStore).registerShortcut({
			name: "cinq-wp-editor/save",
			category: "global",
			description: "Publier les modifications.",
			keyCombination: { modifier: "primary", character: "s" },
		});
	}, []);

	useShortcut("cinq-wp-editor/save", (event) => {
		event.preventDefault();
		requestPublish();
	});

	// The panels' visibility is the root's, which holds the grid.
	useEffect(() => {
		const root = document.getElementById("cinq-wp-editor");

		root.classList.toggle("is-blocks-hidden", !blocksOpen);
		root.classList.toggle("is-inspector-hidden", !inspectorOpen);
	}, [blocksOpen, inspectorOpen]);

	const live = Boolean(state && state.post.status === "publish");
	const run = (action) => ({ close }) => {
		close();
		action();
	};

	useCommand({ name: "cinq-wp-editor/add-block", label: "Ajouter un bloc", icon: plus, callback: run(() => setPicker(true)), disabled: !state });
	useCommand({ name: "cinq-wp-editor/publish", label: live ? "Publier les modifications" : "Enregistrer la page", icon: upload, callback: run(requestPublish), disabled: !changed || Boolean(locked) });
	useCommand({ name: "cinq-wp-editor/discard", label: "Abandonner le brouillon", icon: undo, callback: run(discard), disabled: !changed });
	useCommand({ name: "cinq-wp-editor/blocks", label: blocksOpen ? "Masquer la liste des blocs" : "Afficher la liste des blocs", icon: listView, callback: run(() => setBlocksOpen((open) => !open)) });
	useCommand({ name: "cinq-wp-editor/inspector", label: inspectorOpen ? "Masquer les réglages" : "Afficher les réglages", icon: drawerRight, callback: run(() => setInspectorOpen((open) => !open)) });
	useCommand({ name: "cinq-wp-editor/device-desktop", label: "Aperçu : ordinateur", icon: desktop, callback: run(() => setDevice("desktop")), disabled: device === "desktop" });
	useCommand({ name: "cinq-wp-editor/device-tablet", label: "Aperçu : tablette", icon: tablet, callback: run(() => setDevice("tablet")), disabled: device === "tablet" });
	useCommand({ name: "cinq-wp-editor/device-mobile", label: "Aperçu : mobile", icon: mobile, callback: run(() => setDevice("mobile")), disabled: device === "mobile" });
	useCommand({ name: "cinq-wp-editor/classic", label: "Modifier dans l’éditeur classique", icon: pencil, callback: run(() => window.location.assign(state.post.editUrl)), disabled: !state });
	useCommand({ name: "cinq-wp-editor/view", label: "Voir la page", icon: external, callback: run(() => window.open(state.post.viewUrl, "_blank")), disabled: !live });

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
				h(Button, { icon: arrowLeft, label: "Retour à la liste", href: state.post.listUrl }),
				h(Button, { icon: listView, label: "Liste des blocs", isPressed: blocksOpen, "aria-controls": "cinq-wp-editor-blocks", onClick: () => setBlocksOpen((open) => !open) }),
				h("div", null, h("strong", { className: "cinq-topbar__title" }, state.post.title || "(sans titre)"), h("span", { className: "cinq-topbar__type" }, state.post.typeLabel))
			),
			h(
				"div",
				{ className: "cinq-topbar__devices" },
				h(
					DropdownMenu,
					{ icon: DEVICES.find((choice) => choice.value === device).icon, label: "Aperçu", popoverProps: { placement: "bottom" } },
					({ onClose }) =>
						h(
							MenuGroup,
							{ label: "Aperçu" },
							h(MenuItemsChoice, {
								choices: DEVICES.map((choice) => ({ value: choice.value, label: choice.label })),
								value: device,
								onSelect: (next) => {
									setDevice(next);
									onClose();
								},
							})
						)
				)
			),
			h(
				"div",
				{ className: "cinq-topbar__end" },
				h("span", { className: `cinq-status is-${status}` }, status === "saving" || status === "publishing" ? h(Spinner) : null, statusText),
				h(Button, { variant: "tertiary", href: state.post.editUrl }, "Éditeur classique"),
				changed && h(Button, { variant: "tertiary", isDestructive: true, onClick: discard, disabled: status === "publishing" }, "Abandonner"),
				h(
					Button,
					{ variant: "primary", onClick: requestPublish, disabled: !changed || status === "publishing" || Boolean(locked), isBusy: status === "publishing" },
					isPublished ? "Publier" : "Enregistrer"
				),
				h(Button, { icon: drawerRight, label: "Réglages", isPressed: inspectorOpen, "aria-controls": "cinq-wp-editor-inspector", onClick: () => setInspectorOpen((open) => !open) })
			)
		),
		h("div", { className: "cinq-notice" }, h(NoticeList, { notices: notices.filter((item) => item.type !== "snackbar"), onRemove: forget })),
		h("div", { className: "cinq-snackbars" }, h(SnackbarList, { notices: notices.filter((item) => item.type === "snackbar"), onRemove: forget })),
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
		locked && h(LockedModal, { lock: locked, post: state.post }),
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
