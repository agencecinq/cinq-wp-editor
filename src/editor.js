/**
 * CINQ Éditeur.
 *
 * Three columns: the blocks of the page on the left, the real page in the
 * middle, the fields of the selected block on the right. Every change is saved
 * as the user's draft after a short pause, then the preview fetches the page
 * again and swaps the changed block in.
 *
 * Written in JSX and built with `@wordpress/scripts`, as WordPress's own
 * screens are: the `@wordpress` packages are WordPress's scripts, loaded by
 * handle; only `@wordpress/icons`, which WordPress does not ship as a script,
 * is bundled.
 */
import apiFetch from '@wordpress/api-fetch';
import {
	LinkControl,
	store as blockEditorStore,
} from '@wordpress/block-editor';
import { useCommand } from '@wordpress/commands';
import { useDebouncedInput, useInstanceId } from '@wordpress/compose';
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
	navigateRegions,
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
	__experimentalToggleGroupControl as ToggleGroupControl,
	__experimentalToggleGroupControlOption as ToggleGroupControlOption,
	__experimentalToggleGroupControlOptionIcon as ToggleGroupControlOptionIcon,
} from '@wordpress/components';
// The post editor gives LinkControl this search: the editor does the same.
import { __experimentalFetchLinkSuggestions as fetchLinkSuggestions } from '@wordpress/core-data';
import { dispatch, useDispatch, useSelect } from '@wordpress/data';
import { getSettings as getDateSettings, gmdateI18n } from '@wordpress/date';
import {
	createRoot,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { decodeEntities } from '@wordpress/html-entities';
import { __, _n, sprintf } from '@wordpress/i18n';
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
} from '@wordpress/icons';
import {
	store as keyboardShortcutsStore,
	useShortcut,
} from '@wordpress/keyboard-shortcuts';
import { MediaUpload } from '@wordpress/media-utils';
import { store as noticesStore } from '@wordpress/notices';
import { store as preferencesStore } from '@wordpress/preferences';
import { addQueryArgs } from '@wordpress/url';

const config = window.cinqWpEditor;

// WordPress APIs that are no packages: the media library, the heartbeat and
// the classic editor, which WordPress names `wp.oldEditor` next to the block
// editor's `wp.editor`.
const { media, heartbeat, oldEditor: classicEditor } = window.wp;

// LinkControl searches through the block editor's settings: given the
// search the post editor gives it, WordPress's own over posts and terms.
dispatch( blockEditorStore ).updateSettings( {
	__experimentalFetchLinkSuggestions: ( search, options ) =>
		fetchLinkSuggestions( search, options, {} ),
} );

const SAVE_DELAY = 300;
const ORIGIN = window.location.origin;
const API = `/${ config.namespace }/posts/${ config.postId }`;

// The editor's notices, apart from any other screen's, in WordPress's own store.
const NOTICES = 'cinq-wp-editor';

// The editor's preferences, kept per user as the block editor keeps its own:
// which side panels are open.
const PREFERENCES = 'cinq-wp-editor';

dispatch( preferencesStore ).setDefaults( PREFERENCES, {
	blocksOpen: true,
	inspectorOpen: true,
} );

/**
 * Text from the server, which may carry HTML entities, as text.
 *
 * @param {{message?: string}} error    Error from apiFetch.
 * @param {string}             fallback Message when it has none.
 * @return {string} Message to show.
 */
const messageOf = ( error, fallback ) =>
	decodeEntities( error.message || fallback );

// Preview widths, as the block editor offers them.
const DEVICES = [
	{
		value: 'desktop',
		label: __( 'Desktop', 'cinq-wp-editor' ),
		icon: desktop,
	},
	{ value: 'tablet', label: __( 'Tablet', 'cinq-wp-editor' ), icon: tablet },
	{ value: 'mobile', label: __( 'Mobile', 'cinq-wp-editor' ), icon: mobile },
];

/**
 * Hands ⌘S / Ctrl+S typed in a frame (TinyMCE, the preview) to the
 * document, where the editor's shortcut listens.
 *
 * @param {KeyboardEvent} event Key pressed in the frame.
 */
const forwardSave = ( event ) => {
	if (
		( event.metaKey || event.ctrlKey ) &&
		! event.altKey &&
		event.key.toLowerCase() === 's'
	) {
		event.preventDefault();
		document.dispatchEvent(
			new window.KeyboardEvent( 'keydown', {
				key: 's',
				metaKey: event.metaKey,
				ctrlKey: event.ctrlKey,
				bubbles: true,
			} )
		);
	}
};

let uidSeed = 0;
const uid = () => `block-${ ++uidSeed }`;
const copy = ( value ) =>
	value === undefined ? undefined : JSON.parse( JSON.stringify( value ) );
const toArray = ( value ) => {
	if ( Array.isArray( value ) ) {
		return value;
	}

	return value === undefined || value === null || value === ''
		? []
		: [ value ];
};

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

function defaultsFor( fields ) {
	const values = {};

	( fields || [] ).forEach( ( field ) => {
		const value = defaultFor( field );

		if ( value !== undefined ) {
			values[ field.name ] = value;
		}
	} );

	return values;
}

function defaultFor( field ) {
	const fallback = field.default_value;

	switch ( field.type ) {
		case 'group':
			return defaultsFor( field.sub_fields );

		case 'repeater':
			return Array.from( { length: Number( field.min ) || 0 }, () =>
				defaultsFor( field.sub_fields )
			);

		case 'flexible_content':
			return [];

		case 'true_false':
			return Boolean( Number( fallback ) );

		case 'checkbox':
			return toArray( fallback );

		case 'select':
			if ( field.multiple ) {
				return toArray( fallback );
			}
			if ( Array.isArray( fallback ) ) {
				return fallback[ 0 ];
			}

			return fallback === '' || fallback === null ? undefined : fallback;

		case 'link':
			return fallback && typeof fallback === 'object'
				? copy( fallback )
				: undefined;

		// A default that is an object, such as the icon picker's empty
		// `{ type, value }`, is no value to send.
		default:
			return fallback === undefined ||
				fallback === null ||
				fallback === '' ||
				typeof fallback === 'object'
				? undefined
				: fallback;
	}
}

/**
 * ACF conditional logic, against the sibling fields only.
 *
 * A rule pointing at a field that is not a sibling is considered met: the
 * field shows, which is the safe side.
 *
 * @param {Object}   field    Field, with its `conditional_logic`.
 * @param {Object[]} siblings Fields of the same row.
 * @param {Object}   values   Values of the row, keyed by field name.
 * @return {boolean} Whether the field shows.
 */
function isVisible( field, siblings, values ) {
	const groups = field.conditional_logic;

	if ( ! Array.isArray( groups ) || ! groups.length ) {
		return true;
	}

	const byKey = {};
	siblings.forEach( ( sibling ) => ( byKey[ sibling.key ] = sibling ) );

	return groups.some( ( rules ) =>
		( rules || [] ).every( ( rule ) => {
			const target = byKey[ rule.field ];

			if ( ! target ) {
				return true;
			}

			const value = values ? values[ target.name ] : undefined;
			const empty =
				value === undefined ||
				value === null ||
				value === '' ||
				value === false ||
				value === '0' ||
				( Array.isArray( value ) && ! value.length );
			const checked = value === true || Number( value ) === 1;
			const asString =
				target.type === 'true_false'
					? String( Number( checked ) )
					: String( value ?? '' );
			const equals = Array.isArray( value )
				? value.map( String ).includes( String( rule.value ) )
				: asString === String( rule.value );

			switch ( rule.operator ) {
				case '==':
					return equals;
				case '!=':
					return ! equals;
				case '==empty':
					return empty;
				case '!=empty':
					return ! empty;
				case '==contains':
					return asString.includes( String( rule.value ) );
				case '!=contains':
					return ! asString.includes( String( rule.value ) );
				default:
					return true;
			}
		} )
	);
}

/**
 * A line of text that tells two blocks of the same type apart in the list.
 *
 * @param {unknown} value Block or row values.
 * @return {string} A few words of its first text.
 */
function summaryOf( value ) {
	const found = [];

	( function walk( node, depth ) {
		if (
			found.length ||
			depth > 4 ||
			node === null ||
			node === undefined
		) {
			return;
		}

		if ( typeof node === 'string' ) {
			const text = node
				.replace( /<[^>]+>/g, ' ' )
				.replace( /\s+/g, ' ' )
				.trim();

			if ( text.includes( ' ' ) && ! /^https?:/.test( text ) ) {
				found.push( text );
			}
			return;
		}

		if ( Array.isArray( node ) ) {
			node.forEach( ( item ) => walk( item, depth + 1 ) );
			return;
		}

		if ( typeof node === 'object' ) {
			const keys = Object.keys( node ).filter(
				( key ) => key !== 'acf_fc_layout' && key !== 'layout'
			);
			const preferred = [ 'content', 'title', 'heading', 'text' ];

			keys.sort( ( a, b ) => {
				const rank = ( key ) =>
					preferred.includes( key )
						? preferred.indexOf( key )
						: preferred.length;
				return rank( a ) - rank( b );
			} );
			keys.forEach( ( key ) => walk( node[ key ], depth + 1 ) );
		}
	} )( value, 0 );

	return found[ 0 ] || '';
}

// Editor path of the fixed sections' fields, as the server names it.
const FIELDS = 'fields';

const isUnder = ( path, root ) =>
	path === root ||
	path.startsWith( `${ root }.` ) ||
	path.startsWith( `${ root }[` );
const errorsAt = ( errors, path ) =>
	errors
		.filter( ( error ) => error.path === path )
		.map( ( error ) => error.message );
const errorsUnder = ( errors, path ) =>
	errors.filter( ( error ) => isUnder( error.path, path ) );

/**
 * Whether a path points into one of the fields of a fixed section.
 *
 * @param {Object} section Fixed section, with its fields.
 * @param {string} path    Editor path.
 * @return {boolean} Whether the section holds the path.
 */
const holds = ( section, path ) =>
	section.fields.some( ( field ) =>
		isUnder( path, `${ FIELDS }.${ field.name }` )
	);

/**
 * The values of a fixed section, out of all the sections' fields.
 *
 * @param {Object} section Fixed section, with its fields.
 * @param {Object} fields  Values of every section, keyed by field name.
 * @return {Object} Values of the section.
 */
const valuesOf = ( section, fields ) =>
	Object.fromEntries(
		section.fields.map( ( field ) => [ field.name, fields[ field.name ] ] )
	);

/* ------------------------------------------------------------------ */
/* Fields                                                              */
/* ------------------------------------------------------------------ */

function Fields( { fields, value, onChange, path, errors } ) {
	// Fields named 0, 1… come from PHP as a list: their values all the same.
	const values = value && typeof value === 'object' ? { ...value } : {};

	return (
		<>
			{ ( fields || [] )
				.filter( ( field ) => isVisible( field, fields, values ) )
				.map( ( field ) => (
					<Field
						key={ field.key || field.name }
						field={ field }
						value={ values[ field.name ] }
						onChange={ ( next ) =>
							onChange( {
								...values,
								[ field.name ]: next,
							} )
						}
						path={ `${ path }.${ field.name }` }
						errors={ errors }
					/>
				) ) }
		</>
	);
}

function Field( { field, value, onChange, path, errors } ) {
	const label = field.label + ( Number( field.required ) ? ' *' : '' );
	const help = field.instructions || undefined;
	const own = errorsAt( errors, path );
	const common = { label, help, __nextHasNoMarginBottom: true };
	let control;

	switch ( field.type ) {
		case 'group':
			return (
				<fieldset className="cinq-group">
					<legend>{ field.label }</legend>
					{ help && <p className="cinq-help">{ help }</p> }
					<Fields
						fields={ field.sub_fields }
						value={ value }
						onChange={ onChange }
						path={ path }
						errors={ errors }
					/>
				</fieldset>
			);

		case 'repeater':
			return (
				<RepeaterField
					field={ field }
					value={ value }
					onChange={ onChange }
					path={ path }
					errors={ errors }
				/>
			);

		case 'date_picker':
		case 'date_time_picker':
		case 'time_picker':
			control = (
				<DateField
					field={ field }
					label={ label }
					help={ help }
					value={ value }
					onChange={ onChange }
				/>
			);
			break;

		case 'text':
		case 'email':
		case 'url':
		case 'password':
		case 'oembed':
			control = (
				<TextControl
					{ ...common }
					type={
						[ 'email', 'url' ].includes( field.type )
							? field.type
							: 'text'
					}
					value={ value ?? '' }
					placeholder={ field.placeholder || undefined }
					onChange={ onChange }
				/>
			);
			break;

		case 'number':
		case 'range':
			control = (
				<TextControl
					{ ...common }
					type="number"
					min={ field.min }
					max={ field.max }
					step={ field.step || undefined }
					value={ value ?? '' }
					onChange={ ( next ) =>
						onChange( next === '' ? '' : Number( next ) )
					}
				/>
			);
			break;

		case 'color_picker':
			control = (
				<ColorField
					field={ field }
					label={ label }
					help={ help }
					value={ value }
					onChange={ onChange }
				/>
			);
			break;

		case 'textarea':
			control = (
				<TextareaControl
					{ ...common }
					rows={ Number( field.rows ) || 3 }
					value={ value ?? '' }
					placeholder={ field.placeholder || undefined }
					onChange={ onChange }
				/>
			);
			break;

		case 'wysiwyg':
			// One editor per field and block: another block remounts it.
			control = (
				<WysiwygField
					key={ path }
					field={ field }
					label={ label }
					help={ help }
					value={ value }
					onChange={ onChange }
				/>
			);
			break;

		case 'true_false':
			// ACF stores true_false as "1" / "0": the string "0" is truthy.
			control = (
				<ToggleControl
					{ ...common }
					checked={ value === true || Number( value ) === 1 }
					onChange={ onChange }
				/>
			);
			break;

		case 'button_group':
			control = (
				<ButtonGroupField
					field={ field }
					label={ label }
					help={ help }
					value={ value }
					onChange={ onChange }
				/>
			);
			break;

		case 'select':
		case 'radio':
			if ( field.multiple ) {
				control = (
					<ChoiceList
						field={ field }
						label={ label }
						help={ help }
						value={ value }
						onChange={ onChange }
					/>
				);
				break;
			}

			control = (
				<SelectControl
					{ ...common }
					value={ value ?? '' }
					options={ [
						...( Number( field.allow_null ) ||
						! Number( field.required )
							? [
									{
										label: '—',
										value: '',
									},
								]
							: [] ),
						...Object.entries( field.choices || {} ).map(
							( [ choice, text ] ) => ( {
								value: choice,
								label: String( text ),
							} )
						),
					] }
					onChange={ onChange }
				/>
			);
			break;

		case 'checkbox':
			control = (
				<ChoiceList
					field={ field }
					label={ label }
					help={ help }
					value={ value }
					onChange={ onChange }
				/>
			);
			break;

		case 'link':
			control = (
				<LinkField
					field={ field }
					label={ label }
					help={ help }
					value={ value }
					onChange={ onChange }
				/>
			);
			break;

		case 'image':
		case 'file':
			control = (
				<MediaField
					field={ field }
					label={ label }
					help={ help }
					value={ value }
					onChange={ onChange }
				/>
			);
			break;

		case 'gallery':
			control = (
				<GalleryField
					field={ field }
					label={ label }
					help={ help }
					value={ value }
					onChange={ onChange }
				/>
			);
			break;

		case 'post_object':
		case 'relationship':
		case 'page_link':
			control = (
				<PostField
					field={ field }
					label={ label }
					help={ help }
					value={ value }
					onChange={ onChange }
				/>
			);
			break;

		case 'user':
			control = (
				<UserField
					field={ field }
					label={ label }
					help={ help }
					value={ value }
					onChange={ onChange }
				/>
			);
			break;

		case 'icon_picker':
			control = (
				<IconField
					field={ field }
					label={ label }
					help={ help }
					value={ value }
					onChange={ onChange }
				/>
			);
			break;

		case 'google_map':
			control = (
				<MapField
					field={ field }
					label={ label }
					help={ help }
					value={ value }
					onChange={ onChange }
				/>
			);
			break;

		case 'taxonomy':
			control = (
				<TextControl
					{ ...common }
					help={ [
						help,
						__(
							'Term IDs, separated by commas.',
							'cinq-wp-editor'
						),
					]
						.filter( Boolean )
						.join( ' ' ) }
					value={ toArray( value ).join( ', ' ) }
					onChange={ ( next ) =>
						onChange(
							next
								.split( ',' )
								.map( ( item ) => item.trim() )
								.filter( Boolean )
						)
					}
				/>
			);
			break;

		default:
			control = (
				<div className="cinq-unsupported">
					<strong>{ field.label }</strong>
					<p>
						{ sprintf(
							/* translators: %s: ACF field type. */
							__(
								'“%s” field: edit it in the classic editor for now.',
								'cinq-wp-editor'
							),
							field.type
						) }
					</p>
				</div>
			);
	}

	return (
		<div
			className={ `cinq-field cinq-field--${ field.type }${ own.length ? ' has-error' : '' }` }
		>
			{ control }
			{ own.map( ( message, index ) => (
				<p key={ index } className="cinq-error">
					{ message }
				</p>
			) ) }
		</div>
	);
}

/**
 * Fields whose choices the theme draws as swatches, as its admin styles do:
 * `color_scheme` shows an « A » in the scheme's text colour on its
 * background, `color` the colour itself.
 */
const SWATCH_FIELDS = { color_scheme: 'schemes', color: 'palette' };

// ToggleGroupControl takes an empty value for no selection: ACF's empty
// choice, such as the default scheme, goes by another name in between.
const EMPTY_CHOICE = '__cinq-wp-editor-empty';

/**
 * A choice among a few, as ACF's button group and the block editor's own
 * settings show it: ToggleGroupControl. Schemes and colours of the theme
 * show as swatches, their label in the tooltip.
 *
 * @param {FieldProps} props Field props.
 */
function ButtonGroupField( { field, label, help, value, onChange } ) {
	const choices = Object.entries( field.choices || {} );
	const kind = SWATCH_FIELDS[ field.name ];
	const swatches = ( kind && config.swatches[ kind ] ) || {};
	const drawn =
		choices.length > 0 &&
		choices.every( ( [ choice ] ) => choice in swatches );
	const current =
		value === '' || value === null || value === undefined
			? EMPTY_CHOICE
			: String( value );

	return (
		<ToggleGroupControl
			label={ label }
			help={ help }
			value={ current }
			isBlock={ ! drawn }
			isDeselectable={ Boolean( Number( field.allow_null ) ) }
			onChange={ ( next ) =>
				onChange(
					next === EMPTY_CHOICE || next === undefined ? '' : next
				)
			}
			__next40pxDefaultSize
			__nextHasNoMarginBottom
		>
			{ choices.map( ( [ choice, text ] ) => {
				const optionValue = choice === '' ? EMPTY_CHOICE : choice;

				if ( ! drawn ) {
					return (
						<ToggleGroupControlOption
							key={ optionValue }
							value={ optionValue }
							label={ String( text ) }
						/>
					);
				}

				const colors = swatches[ choice ];

				return (
					<ToggleGroupControlOptionIcon
						key={ optionValue }
						value={ optionValue }
						label={ String( text ) }
						icon={
							<span
								className="cinq-swatch"
								style={ {
									background: colors.background,
									color: colors.foreground,
								} }
								aria-hidden="true"
							>
								{ 'schemes' === kind ? 'A' : null }
							</span>
						}
					/>
				);
			} ) }
		</ToggleGroupControl>
	);
}

/**
 * Props of a field control.
 *
 * @typedef {Object} FieldProps
 * @property {Object}                   field    ACF field, as the editor receives it.
 * @property {string}                   label    Label, with « * » when the field is required.
 * @property {string}                   [help]   Instructions of the field.
 * @property {unknown}                  value    Value, as ACF stores it.
 * @property {(value: unknown) => void} onChange Called with the new value.
 */

/**
 * Dates as ACF stores them: `Ymd` for a date, `Y-m-d H:i:s` for a date and
 * time, `H:i:s` for a time. WordPress's pickers read and write ISO strings.
 */
const DATE_KINDS = {
	date_picker: {
		picker: DatePicker,
		toIso: ( value ) =>
			/^\d{8}$/.test( value )
				? `${ value.slice( 0, 4 ) }-${ value.slice( 4, 6 ) }-${ value.slice( 6, 8 ) }T00:00:00`
				: null,
		fromIso: ( iso ) => iso.slice( 0, 10 ).replaceAll( '-', '' ),
		format: ( formats ) => formats.date,
	},
	date_time_picker: {
		picker: DateTimePicker,
		toIso: ( value ) =>
			/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test( value )
				? value.replace( ' ', 'T' )
				: null,
		fromIso: ( iso ) => iso.slice( 0, 19 ).replace( 'T', ' ' ),
		format: ( formats ) => `${ formats.date } ${ formats.time }`,
	},
	time_picker: {
		picker: TimePicker,
		toIso: ( value ) =>
			/^\d{2}:\d{2}(:\d{2})?$/.test( value )
				? `1970-01-01T${ value }`
				: null,
		fromIso: ( iso ) => iso.slice( 11, 19 ),
		format: ( formats ) => formats.time,
	},
};

/**
 * A date, time or both, as the block editor sets a post's date: a button
 * showing the value in the field's display format, opening the picker.
 *
 * @param {FieldProps} props Field props.
 */
function DateField( { field, label, help, value, onChange } ) {
	const kind = DATE_KINDS[ field.type ];
	const settings = getDateSettings();
	const iso = kind.toIso( String( value ?? '' ) );
	// The block editor's own test for a 12-hour site format.
	const is12Hour = /a(?!\\)/i.test(
		settings.formats.time
			.toLowerCase()
			.replace( /\\\\/g, '' )
			.split( '' )
			.reverse()
			.join( '' )
	);
	// Wall-clock values: formatted as UTC so no time zone shifts them.
	const shown = iso
		? gmdateI18n(
				field.display_format || kind.format( settings.formats ),
				`${ iso }Z`
			)
		: '';
	const pickerProps =
		field.type === 'time_picker'
			? { currentTime: iso, is12Hour }
			: {
					currentDate: iso,
					is12Hour,
					startOfWeek:
						field.first_day === undefined
							? settings.l10n.startOfWeek
							: Number( field.first_day ),
				};

	return (
		<div className="components-base-control cinq-date">
			<BaseControl.VisualLabel>{ label }</BaseControl.VisualLabel>
			<Dropdown
				popoverProps={ {
					placement: 'left-start',
				} }
				renderToggle={ ( { isOpen, onToggle } ) => (
					<Button
						variant="secondary"
						onClick={ onToggle }
						aria-expanded={ isOpen }
						aria-label={ sprintf(
							/* translators: 1: Field label. 2: Its value. */
							__( '%1$s: %2$s', 'cinq-wp-editor' ),
							field.label,
							shown || __( 'no value', 'cinq-wp-editor' )
						) }
					>
						{ shown || __( 'Choose…', 'cinq-wp-editor' ) }
					</Button>
				) }
				renderContent={ ( { onClose } ) => (
					<div className="cinq-date__picker">
						<kind.picker
							{ ...pickerProps }
							onChange={ ( next ) =>
								onChange( kind.fromIso( next ) )
							}
						/>
						{ ! Number( field.required ) && value && (
							<Button
								variant="tertiary"
								isDestructive
								onClick={ () => {
									onChange( '' );
									onClose();
								} }
							>
								{ __( 'Clear', 'cinq-wp-editor' ) }
							</Button>
						) }
					</div>
				) }
			/>
			{ help && (
				<p className="components-base-control__help">{ help }</p>
			) }
		</div>
	);
}

/**
 * `#rrggbbaa` from WordPress's picker, as ACF stores a colour with
 * opacity: `rgba(r,g,b,a)`.
 *
 * @param {string} hex Colour, `#rrggbbaa`.
 * @return {string} The same colour, `rgba(r,g,b,a)`.
 */
const toRgba = ( hex ) => {
	const [ red, green, blue, alpha ] = [ 1, 3, 5, 7 ].map( ( start ) =>
		parseInt( hex.slice( start, start + 2 ), 16 )
	);

	return `rgba(${ red },${ green },${ blue },${ Number( ( alpha / 255 ).toFixed( 2 ) ) })`;
};

/**
 * A colour, as the block editor picks one: a swatch and its value,
 * opening WordPress's colour picker.
 *
 * @param {FieldProps} props Field props.
 */
function ColorField( { field, label, help, value, onChange } ) {
	const alpha = Boolean( Number( field.enable_opacity ) );
	const color = typeof value === 'string' ? value : '';

	return (
		<div className="components-base-control cinq-color">
			<BaseControl.VisualLabel>{ label }</BaseControl.VisualLabel>
			<Dropdown
				popoverProps={ {
					placement: 'left-start',
				} }
				renderToggle={ ( { isOpen, onToggle } ) => (
					<Button
						variant="secondary"
						className="cinq-color__toggle"
						onClick={ onToggle }
						aria-expanded={ isOpen }
						aria-label={ sprintf(
							/* translators: 1: Field label. 2: Its value. */
							__( '%1$s: %2$s', 'cinq-wp-editor' ),
							field.label,
							color || __( 'no color', 'cinq-wp-editor' )
						) }
					>
						<ColorIndicator colorValue={ color || 'transparent' } />
						{ color || __( 'Choose…', 'cinq-wp-editor' ) }
					</Button>
				) }
				renderContent={ ( { onClose } ) => (
					<div className="cinq-color__picker">
						<ColorPicker
							color={ color || undefined }
							enableAlpha={ alpha }
							onChange={ ( next ) =>
								onChange(
									alpha && next.length === 9
										? toRgba( next )
										: next
								)
							}
						/>
						{ ! Number( field.required ) && color && (
							<Button
								variant="tertiary"
								isDestructive
								onClick={ () => {
									onChange( '' );
									onClose();
								} }
							>
								{ __( 'Clear', 'cinq-wp-editor' ) }
							</Button>
						) }
					</div>
				) }
			/>
			{ help && (
				<p className="components-base-control__help">{ help }</p>
			) }
		</div>
	);
}

/**
 * The post is locked by someone else, as the block editor says it: who
 * holds it, and the way back or the way in. Nothing behind can be used.
 *
 * @param {Object} props      Modal props.
 * @param {Object} props.lock Who holds the lock: `text`, `avatar`, `canTakeOver`, `takeOverUrl`, `takenOver`.
 * @param {Object} props.post The post: its `listUrl`.
 */
function LockedModal( { lock, post } ) {
	const takeOver = ! lock.takenOver && lock.canTakeOver;

	return (
		<Modal
			title={
				lock.takenOver
					? __( 'Someone else has taken over', 'cinq-wp-editor' )
					: __(
							'This content is already being edited',
							'cinq-wp-editor'
						)
			}
			className="cinq-lock"
			isDismissible={ false }
			shouldCloseOnEsc={ false }
			shouldCloseOnClickOutside={ false }
			onRequestClose={ () => {} }
		>
			<div className="cinq-lock__body">
				{ lock.avatar && (
					<img
						className="cinq-lock__avatar"
						src={ lock.avatar }
						alt=""
						width={ 64 }
						height={ 64 }
					/>
				) }
				<div>
					<p>{ decodeEntities( lock.text ) }</p>
					{ lock.takenOver && (
						<p>
							{ __(
								'Your unpublished changes stay in your draft: you will find them again when you reopen the page.',
								'cinq-wp-editor'
							) }
						</p>
					) }
				</div>
			</div>
			<div className="cinq-confirm__actions">
				<Button
					variant={ takeOver ? 'secondary' : 'primary' }
					href={ post.listUrl }
				>
					{ __( 'Back to the list', 'cinq-wp-editor' ) }
				</Button>
				{ takeOver && (
					<Button variant="primary" href={ lock.takeOverUrl }>
						{ __( 'Take over', 'cinq-wp-editor' ) }
					</Button>
				) }
			</div>
		</Modal>
	);
}

/**
 * The « Options » menu of a block or a row, as the block editor's list
 * view has one: an action missing from the props is left out, one passed
 * as null is shown disabled.
 *
 * @param {Object}            props               Menu props.
 * @param {string}            props.label         Name of the block or row.
 * @param {(() => void)|null} [props.onDuplicate] Duplicates it; null shows it disabled.
 * @param {(() => void)|null} [props.onUp]        Moves it up; null shows it disabled.
 * @param {(() => void)|null} [props.onDown]      Moves it down; null shows it disabled.
 * @param {(() => void)|null} [props.onRemove]    Removes it; null shows it disabled.
 */
function RowMenu( { label, onDuplicate, onUp, onDown, onRemove } ) {
	const item = ( text, action, extra = {} ) =>
		action === undefined ? null : (
			<MenuItem
				{ ...extra }
				disabled={ action === null }
				onClick={ action ? () => action() : undefined }
			>
				{ text }
			</MenuItem>
		);

	return (
		<DropdownMenu
			icon={ moreVertical }
			label={ sprintf(
				/* translators: %s: Name of the block or row. */
				__( 'Options: %s', 'cinq-wp-editor' ),
				label
			) }
			toggleProps={ {
				size: 'small',
			} }
			popoverProps={ {
				placement: 'bottom-end',
			} }
		>
			{ ( { onClose } ) => {
				const then = ( action ) =>
					action
						? () => {
								onClose();
								action();
							}
						: action;
				return (
					<>
						<MenuGroup>
							{ item(
								__( 'Duplicate', 'cinq-wp-editor' ),
								then( onDuplicate )
							) }
							{ item(
								__( 'Move up', 'cinq-wp-editor' ),
								then( onUp )
							) }
							{ item(
								__( 'Move down', 'cinq-wp-editor' ),
								then( onDown )
							) }
						</MenuGroup>
						<MenuGroup>
							{ item(
								__( 'Delete', 'cinq-wp-editor' ),
								then( onRemove ),
								{
									isDestructive: true,
								}
							) }
						</MenuGroup>
					</>
				);
			} }
		</DropdownMenu>
	);
}

/**
 * TinyMCE, as ACF and the classic edit screen run it: same toolbars (ACF's,
 * with the theme's `acf/fields/wysiwyg/toolbars`), same Visual / Code tabs,
 * same « Ajouter un média » button. The textarea is created outside React,
 * which must not touch the markup TinyMCE builds around it.
 *
 * @param {FieldProps} props Field props.
 */
function WysiwygField( { field, label, help, value, onChange } ) {
	const id = useInstanceId( WysiwygField, 'cinq-wysiwyg' );
	const holder = useRef( null );
	const content = useRef( value ?? '' );
	const latest = useRef( onChange );

	latest.current = onChange;

	useEffect( () => {
		const node = holder.current;
		const textarea = document.createElement( 'textarea' );
		const tabs = field.tabs || 'all';
		const toolbar =
			config.toolbars[ field.toolbar ] || config.toolbars.full || {};

		textarea.id = id;
		textarea.className = 'wp-editor-area';
		textarea.rows = 10;
		textarea.value = content.current;
		node.appendChild( textarea );

		const emit = () => {
			const next = classicEditor.getContent( id );

			if ( next !== content.current ) {
				content.current = next;
				latest.current( next );
			}
		};

		classicEditor.initialize( id, {
			tinymce:
				tabs === 'text'
					? false
					: {
							wpautop: true,
							toolbar1: toolbar[ 1 ] || '',
							toolbar2: toolbar[ 2 ] || '',
							toolbar3: toolbar[ 3 ] || '',
							toolbar4: toolbar[ 4 ] || '',
							setup: ( editor ) => {
								editor.on(
									'input change undo redo ExecCommand',
									emit
								);
								editor.on( 'keydown', forwardSave );
							},
						},
			quicktags: tabs !== 'visual',
			mediaButtons: Number( field.media_upload ) === 1,
		} );

		// The Code tab, and the editor without TinyMCE, type in the textarea.
		textarea.addEventListener( 'input', emit );

		return () => {
			textarea.removeEventListener( 'input', emit );
			classicEditor.remove( id );
			node.replaceChildren();
		};
		// The field's settings stay the same while it is shown.
	}, [ id, field.media_upload, field.tabs, field.toolbar ] );

	// A value changed from outside, by « Abandonner » for instance.
	useEffect( () => {
		const next = value ?? '';

		if ( next === content.current ) {
			return;
		}

		content.current = next;

		const editor = window.tinymce && window.tinymce.get( id );

		if ( editor && ! editor.isHidden() ) {
			editor.setContent(
				classicEditor.autop ? classicEditor.autop( next ) : next
			);
		} else {
			document.getElementById( id ).value = next;
		}
	}, [ value, id ] );

	return (
		<BaseControl
			id={ id }
			label={ label }
			help={ help }
			__nextHasNoMarginBottom
		>
			<div ref={ holder } className="cinq-wysiwyg" />
		</BaseControl>
	);
}

/**
 * A confirmation, as the block editor asks one: a small modal, the
 * destructive action in red, Escape or « Annuler » to back out.
 *
 * @param {Object}     props           Dialog props.
 * @param {string}     props.title     Question asked.
 * @param {string}     props.text      What the action does.
 * @param {string}     props.label     Label of the destructive button.
 * @param {() => void} props.onConfirm Called on confirming.
 * @param {() => void} props.onCancel  Called on backing out.
 */
function Confirm( { title, text, label, onConfirm, onCancel } ) {
	return (
		<Modal title={ title } size="small" onRequestClose={ onCancel }>
			<p className="cinq-confirm__text">{ text }</p>
			<div className="cinq-confirm__actions">
				<Button variant="tertiary" onClick={ onCancel }>
					{ __( 'Cancel', 'cinq-wp-editor' ) }
				</Button>
				<Button variant="primary" isDestructive onClick={ onConfirm }>
					{ label }
				</Button>
			</div>
		</Modal>
	);
}

function ChoiceList( { field, label, help, value, onChange } ) {
	const selected = toArray( value ).map( String );

	return (
		<fieldset className="cinq-choices">
			<legend>{ label }</legend>
			{ Object.entries( field.choices || {} ).map(
				( [ choice, text ] ) => (
					<CheckboxControl
						key={ choice }
						label={ String( text ) }
						checked={ selected.includes( choice ) }
						onChange={ ( checked ) =>
							onChange(
								checked
									? [ ...selected, choice ]
									: selected.filter(
											( item ) => item !== choice
										)
							)
						}
						__nextHasNoMarginBottom
					/>
				)
			) }
			{ help && <p className="cinq-help">{ help }</p> }
		</fieldset>
	);
}

/**
 * A link, as the block editor edits one: its LinkControl, in a popover
 * opened from a button showing the link. Search, direct entry, the link
 * text and « Ouvrir dans un nouvel onglet » are WordPress's own. ACF stores
 * `{ title, url, target }`.
 *
 * @param {FieldProps} props Field props.
 */
function LinkField( { field, label, help, value, onChange } ) {
	const link = value && typeof value === 'object' && value.url ? value : null;
	const current = link
		? {
				url: link.url,
				title: link.title || '',
				opensInNewTab: link.target === '_blank',
			}
		: undefined;
	const save = ( next ) =>
		onChange( {
			title: next.title || '',
			url: next.url || '',
			target: next.opensInNewTab ? '_blank' : '',
		} );
	const shown = link ? link.title || link.url : '';

	return (
		<div className="components-base-control cinq-link">
			<BaseControl.VisualLabel>{ label }</BaseControl.VisualLabel>
			<Dropdown
				popoverProps={ {
					placement: 'left-start',
				} }
				renderToggle={ ( { isOpen, onToggle } ) => (
					<Button
						variant="secondary"
						className="cinq-link__toggle"
						icon={ linkIcon }
						onClick={ onToggle }
						aria-expanded={ isOpen }
						aria-label={ sprintf(
							/* translators: 1: Field label. 2: Its value. */
							__( '%1$s: %2$s', 'cinq-wp-editor' ),
							field.label,
							shown || __( 'no link', 'cinq-wp-editor' )
						) }
					>
						{ shown || __( 'Add a link', 'cinq-wp-editor' ) }
					</Button>
				) }
				renderContent={ ( { onClose } ) => (
					<LinkControl
						value={ current }
						onChange={ save }
						onRemove={ () => {
							onChange( '' );
							onClose();
						} }
						hasTextControl
						forceIsEditingLink={ ! link }
						withCreateSuggestion={ false }
					/>
				) }
			/>
			{ link && link.title && (
				<p className="components-base-control__help cinq-link__url">
					{ link.url }
				</p>
			) }
			{ help && (
				<p className="components-base-control__help">{ help }</p>
			) }
		</div>
	);
}

function useAttachment( id ) {
	const [ attachment, setAttachment ] = useState( null );

	useEffect( () => {
		if ( ! id ) {
			setAttachment( null );
			return;
		}

		let alive = true;
		const model = media.attachment( id );

		model
			.fetch()
			.then( () => alive && setAttachment( model.toJSON() ) )
			.catch( () => alive && setAttachment( null ) );

		return () => {
			alive = false;
		};
	}, [ id ] );

	return attachment;
}

function Thumbnail( { id } ) {
	const attachment = useAttachment( id );

	if ( ! attachment ) {
		return <span className="cinq-thumb is-loading">{ `#${ id }` }</span>;
	}

	const sizes = attachment.sizes || {};
	const src =
		( sizes.medium || sizes.thumbnail || {} ).url ||
		( attachment.type === 'image' ? attachment.url : '' );

	return src ? (
		<img className="cinq-thumb" src={ src } alt={ attachment.alt || '' } />
	) : (
		<span className="cinq-thumb is-file">
			{ attachment.filename || `#${ id }` }
		</span>
	);
}

function MediaField( { field, label, help, value, onChange } ) {
	const id = Number( value ) || 0;

	return (
		<div className="cinq-media">
			<span className="cinq-label">{ label }</span>
			{ id ? <Thumbnail id={ id } /> : null }
			<div className="cinq-media__actions">
				<MediaUpload
					title={ field.label }
					allowedTypes={
						field.type === 'image' ? [ 'image' ] : undefined
					}
					value={ id || undefined }
					onSelect={ ( attachment ) =>
						onChange( attachment.id || '' )
					}
					render={ ( { open } ) => (
						<Button
							variant="secondary"
							size="compact"
							onClick={ open }
						>
							{ id
								? __( 'Replace', 'cinq-wp-editor' )
								: __( 'Choose', 'cinq-wp-editor' ) }
						</Button>
					) }
				/>
				{ id ? (
					<Button
						variant="tertiary"
						size="compact"
						isDestructive
						onClick={ () => onChange( '' ) }
					>
						{ __( 'Remove', 'cinq-wp-editor' ) }
					</Button>
				) : null }
			</div>
			{ help && <p className="cinq-help">{ help }</p> }
		</div>
	);
}

function GalleryField( { field, label, help, value, onChange } ) {
	const ids = toArray( value ).map( Number ).filter( Boolean );
	// ACF checks the maximum in its interface only, not when saving.
	const max = Number( field.max ) || 0;
	const full = max > 0 && ids.length >= max;

	return (
		<div className="cinq-media">
			<span className="cinq-label">{ label }</span>
			<div className="cinq-gallery">
				{ ids.map( ( id ) => (
					<span key={ id } className="cinq-gallery__item">
						<Thumbnail id={ id } />
						<Button
							icon={ closeSmall }
							size="small"
							label={ __( 'Remove', 'cinq-wp-editor' ) }
							onClick={ () =>
								onChange(
									ids.filter( ( item ) => item !== id )
								)
							}
						/>
					</span>
				) ) }
			</div>
			{ /* The library opens with the gallery selected, as ACF's does. */ }
			<MediaUpload
				title={ field.label }
				allowedTypes={ [ 'image' ] }
				multiple
				value={ ids }
				onSelect={ ( attachments ) =>
					onChange(
						attachments
							.map( ( attachment ) => attachment.id )
							.slice( 0, max || undefined )
					)
				}
				render={ ( { open } ) => (
					<Button
						variant="secondary"
						size="compact"
						disabled={ full }
						onClick={ open }
					>
						{ __( 'Add images', 'cinq-wp-editor' ) }
					</Button>
				) }
			/>
			{ full && (
				<p className="cinq-help">
					{ sprintf(
						/* translators: %d: Most images the gallery takes. */
						_n(
							'%d image at most.',
							'%d images at most.',
							max,
							'cinq-wp-editor'
						),
						max
					) }
				</p>
			) }
			{ help && <p className="cinq-help">{ help }</p> }
		</div>
	);
}

/**
 * Picks references: contents, users or archives. Selected ones are listed
 * by title, a search finds more. `lookup` names the selected IDs it does
 * not know yet, `search` finds candidates, `extra` are fixed options shown
 * before any search, such as a page link's archives.
 */
/**
 * Returns a ref always holding the latest value, for an effect that must read
 * it without running again each time it changes.
 *
 * @param {unknown} value Value to keep.
 * @return {{current: unknown}} Ref to the value.
 */
function useLatest( value ) {
	const ref = useRef( value );

	ref.current = value;

	return ref;
}

function ReferenceField( {
	label,
	help,
	multiple,
	value,
	onChange,
	lookup,
	search,
	extra = [],
	placeholder,
	empty,
} ) {
	// IDs come back from ACF as strings; archive links are URLs.
	const normalize = ( item ) =>
		/^\d+$/.test( String( item ) ) ? Number( item ) : String( item );
	const ids = toArray( value ).map( normalize ).filter( Boolean );
	const [ titles, setTitles ] = useState( () =>
		Object.fromEntries( extra.map( ( item ) => [ item.id, item.title ] ) )
	);
	const [ query, setQuery, searched ] = useDebouncedInput( '' );
	const [ results, setResults ] = useState( [] );
	// The callers pass new functions on each render: searching again for
	// that would never end.
	const titlesRef = useLatest( titles );
	const source = useLatest( { lookup, search, extra } );
	const key = JSON.stringify( ids );

	useEffect( () => {
		const missing = JSON.parse( key ).filter(
			( id ) => typeof id === 'number' && ! ( id in titlesRef.current )
		);

		if ( ! missing.length ) {
			return;
		}

		source.current
			.lookup( missing )
			.then( ( list ) =>
				setTitles( ( known ) => ( {
					...known,
					...Object.fromEntries(
						list.map( ( item ) => [ item.id, item.title ] )
					),
				} ) )
			)
			.catch( () => {} );
	}, [ key, titlesRef, source ] );

	useEffect( () => {
		const term = searched.trim().toLowerCase();

		if ( term.length < 2 ) {
			setResults( [] );
			return;
		}

		const fixed = source.current.extra.filter( ( item ) =>
			item.title.toLowerCase().includes( term )
		);

		source.current
			.search( searched )
			.then( ( list ) => setResults( [ ...fixed, ...list ] ) )
			.catch( () => setResults( fixed ) );
	}, [ searched, source ] );

	const set = ( next ) => {
		if ( multiple ) {
			onChange( next );
			return;
		}

		onChange( next.length ? next[ next.length - 1 ] : '' );
	};
	const shown = ( query.trim().length < 2 ? extra : results ).filter(
		( item ) => ! ids.includes( item.id )
	);

	return (
		<div className="cinq-posts">
			<span className="cinq-label">{ label }</span>
			{ ids.length ? (
				<ul className="cinq-posts__selected">
					{ ids.map( ( id ) => (
						<li key={ id }>
							<span>
								{ titles[ id ] ||
									( typeof id === 'number'
										? `#${ id }`
										: id ) }
							</span>
							<Button
								icon={ closeSmall }
								size="small"
								label={ __( 'Remove', 'cinq-wp-editor' ) }
								onClick={ () =>
									set( ids.filter( ( item ) => item !== id ) )
								}
							/>
						</li>
					) ) }
				</ul>
			) : (
				<p className="cinq-help">{ empty }</p>
			) }
			<SearchControl
				value={ query }
				onChange={ setQuery }
				placeholder={ placeholder }
				__nextHasNoMarginBottom
			/>
			{ shown.length ? (
				<ul className="cinq-posts__results">
					{ shown.map( ( item ) => (
						<li key={ item.id }>
							<Button
								variant="link"
								onClick={ () => {
									setTitles( ( known ) => ( {
										...known,
										[ item.id ]: item.title,
									} ) );
									set( [ ...ids, item.id ] );
									setQuery( '' );
								} }
							>
								{ item.title || `#${ item.id }` }
							</Button>
						</li>
					) ) }
				</ul>
			) : null }
			{ help && <p className="cinq-help">{ help }</p> }
		</div>
	);
}

/**
 * Contents, through WordPress's search route: post objects, relationships
 * and page links, whose archives come as fixed options.
 *
 * @param {FieldProps} props Field props.
 */
function PostField( { field, label, help, value, onChange } ) {
	const subtype =
		Array.isArray( field.post_type ) && field.post_type.length
			? field.post_type.join( ',' )
			: 'any';
	// Titles come rendered, with HTML entities: ‘&#8217;’ for an apostrophe.
	const find = ( args ) =>
		apiFetch( {
			path: addQueryArgs( '/wp/v2/search', {
				type: 'post',
				subtype,
				...args,
			} ),
		} ).then( ( list ) =>
			list.map( ( item ) => ( {
				...item,
				title: decodeEntities( item.title ),
			} ) )
		);

	return (
		<ReferenceField
			label={ label }
			help={ help }
			value={ value }
			onChange={ onChange }
			multiple={
				field.type === 'relationship' ||
				Boolean( Number( field.multiple ) )
			}
			lookup={ ( ids ) =>
				find( {
					include: ids.join( ',' ),
					per_page: ids.length,
				} )
			}
			search={ ( query ) =>
				find( {
					search: query,
					per_page: 8,
				} )
			}
			extra={ field.archives || [] }
			placeholder={ __( 'Search content…', 'cinq-wp-editor' ) }
			empty={ __( 'No content chosen.', 'cinq-wp-editor' ) }
		/>
	);
}

/**
 * Users, through the editor's own route: ACF's search, among the roles the
 * field allows.
 *
 * @param {FieldProps} props Field props.
 */
function UserField( { field, label, help, value, onChange } ) {
	const find = ( args ) =>
		apiFetch( {
			path: addQueryArgs( `${ API }/users`, {
				field: field.key,
				...args,
			} ),
		} );

	return (
		<ReferenceField
			label={ label }
			help={ help }
			value={ value }
			onChange={ onChange }
			multiple={ Boolean( Number( field.multiple ) ) }
			lookup={ ( ids ) =>
				find( {
					include: ids,
				} )
			}
			search={ ( query ) =>
				find( {
					search: query,
				} )
			}
			placeholder={ __( 'Search users…', 'cinq-wp-editor' ) }
			empty={ __( 'No user chosen.', 'cinq-wp-editor' ) }
		/>
	);
}

/**
 * An icon, as ACF's icon picker stores it: `{ type, value }`, a Dashicon
 * class, an attachment ID or a URL. One tab per kind the field allows.
 *
 * @param {FieldProps} props Field props.
 */
function IconField( { field, label, help, value, onChange } ) {
	const tabs = field.icon_tabs || [];
	const icon =
		value && typeof value === 'object' && value.type ? value : null;
	const [ query, setQuery ] = useState( '' );
	const set = ( type, next ) =>
		onChange( next === '' || next === null ? '' : { type, value: next } );

	if ( ! tabs.length ) {
		return (
			<p className="cinq-help">
				{ sprintf(
					/* translators: %s: Field label. */
					__(
						'%s: none of the tabs of this field is available here.',
						'cinq-wp-editor'
					),
					field.label
				) }
			</p>
		);
	}

	const term = query.trim().toLowerCase();
	const dashicons = Object.entries( config.dashicons || {} ).filter(
		( [ name, text ] ) =>
			! term ||
			name.includes( term ) ||
			text.toLowerCase().includes( term )
	);

	const panels = {
		dashicons: () => (
			<>
				<SearchControl
					value={ query }
					onChange={ setQuery }
					placeholder={ __( 'Search icons…', 'cinq-wp-editor' ) }
					__nextHasNoMarginBottom
				/>
				<div className="cinq-icons" role="list">
					{ dashicons.map( ( [ name, text ] ) => (
						<Button
							key={ name }
							role="listitem"
							icon={ name.replace( /^dashicons-/, '' ) }
							label={ text }
							isPressed={ Boolean(
								icon &&
								icon.type === 'dashicons' &&
								icon.value === name
							) }
							onClick={ () => set( 'dashicons', name ) }
						/>
					) ) }
				</div>
			</>
		),
		media_library: () => (
			<MediaField
				field={ {
					...field,
					type: 'image',
				} }
				label={ __( 'Image', 'cinq-wp-editor' ) }
				value={
					icon && icon.type === 'media_library' ? icon.value : ''
				}
				onChange={ ( id ) => set( 'media_library', id ) }
			/>
		),
		url: () => (
			<TextControl
				label={ __( 'Image address', 'cinq-wp-editor' ) }
				type="url"
				value={ icon && icon.type === 'url' ? icon.value : '' }
				onChange={ ( url ) => set( 'url', url ) }
				__nextHasNoMarginBottom
			/>
		),
	};

	return (
		<div className="components-base-control cinq-icon">
			<BaseControl.VisualLabel>{ label }</BaseControl.VisualLabel>
			<TabPanel
				className="cinq-icon__tabs"
				initialTabName={
					icon && tabs.some( ( tab ) => tab.name === icon.type )
						? icon.type
						: tabs[ 0 ].name
				}
				tabs={ tabs.map( ( tab ) => ( {
					name: tab.name,
					title: tab.label,
				} ) ) }
			>
				{ ( tab ) => (
					<div className="cinq-icon__panel">
						{ panels[ tab.name ]() }
					</div>
				) }
			</TabPanel>
			{ icon && ! Number( field.required ) && (
				<Button
					variant="tertiary"
					isDestructive
					size="compact"
					onClick={ () => onChange( '' ) }
				>
					{ __( 'Remove the icon', 'cinq-wp-editor' ) }
				</Button>
			) }
			{ help && (
				<p className="components-base-control__help">{ help }</p>
			) }
		</div>
	);
}

/**
 * A place, as ACF's Google Map field stores it: an address and its
 * coordinates. ACF draws a Google map only with an API key; the fields are
 * the same either way, and a link shows the place on Google Maps.
 *
 * @param {FieldProps} props Field props.
 */
function MapField( { field, label, help, value, onChange } ) {
	const place = value && typeof value === 'object' ? value : {};
	const set = ( key, next ) => {
		const updated = { ...place, [ key ]: next };
		const filled = [ 'address', 'lat', 'lng' ].some(
			( name ) =>
				updated[ name ] !== '' &&
				updated[ name ] !== undefined &&
				updated[ name ] !== null
		);

		onChange( filled ? updated : '' );
	};
	const lat = place.lat ?? '';
	const lng = place.lng ?? '';
	const number = ( key, text, extra ) => (
		<TextControl
			label={ text }
			type="number"
			step="any"
			value={ place[ key ] ?? '' }
			onChange={ ( next ) =>
				set( key, next === '' ? '' : Number( next ) )
			}
			__nextHasNoMarginBottom
			{ ...extra }
		/>
	);

	return (
		<fieldset className="cinq-group cinq-map">
			<legend>{ label }</legend>
			{ help && <p className="cinq-help">{ help }</p> }
			<TextControl
				label={ __( 'Address', 'cinq-wp-editor' ) }
				value={ place.address ?? '' }
				onChange={ ( next ) => set( 'address', next ) }
				__nextHasNoMarginBottom
			/>
			<div className="cinq-map__coords">
				{ number( 'lat', __( 'Latitude', 'cinq-wp-editor' ), {
					placeholder: field.center_lat || undefined,
				} ) }
				{ number( 'lng', __( 'Longitude', 'cinq-wp-editor' ), {
					placeholder: field.center_lng || undefined,
				} ) }
			</div>
			{ number( 'zoom', __( 'Zoom', 'cinq-wp-editor' ), {
				min: 1,
				max: 21,
				step: 1,
				placeholder: field.zoom || undefined,
			} ) }
			{ lat !== '' && lng !== '' && (
				<Button
					variant="link"
					href={ `https://www.google.com/maps/search/?api=1&query=${ lat },${ lng }` }
					target="_blank"
				>
					{ __( 'View on Google Maps', 'cinq-wp-editor' ) }
				</Button>
			) }
		</fieldset>
	);
}

function RepeaterField( { field, value, onChange, path, errors } ) {
	const rows = Array.isArray( value ) ? value : [];
	const [ open, setOpen ] = useState( null );
	const max = Number( field.max ) || 0;
	const min = Number( field.min ) || 0;

	const update = ( index, row ) =>
		onChange(
			rows.map( ( item, position ) =>
				position === index ? row : item
			)
		);
	const remove = ( index ) => {
		onChange( rows.filter( ( item, position ) => position !== index ) );
		setOpen( null );
	};
	const move = ( index, delta ) => {
		const next = rows.slice();
		const [ row ] = next.splice( index, 1 );
		next.splice( index + delta, 0, row );
		onChange( next );
		setOpen( open === index ? index + delta : open );
	};
	const add = () => {
		onChange( [ ...rows, defaultsFor( field.sub_fields ) ] );
		setOpen( rows.length );
	};
	const duplicate = ( index ) => {
		const next = rows.slice();
		next.splice( index + 1, 0, copy( rows[ index ] ) );
		onChange( next );
		setOpen( index + 1 );
	};

	return (
		<fieldset className="cinq-repeater">
			<legend>
				{ field.label }
				<span className="cinq-count">{ rows.length }</span>
			</legend>
			{ field.instructions && (
				<p className="cinq-help">{ field.instructions }</p>
			) }
			<ol className="cinq-repeater__rows">
				{ rows.map( ( row, index ) => {
					const rowPath = `${ path }[${ index }]`;
					const hasError = errorsUnder( errors, rowPath ).length > 0;
					return (
						<li
							key={ index }
							className={ `cinq-repeater__row${ open === index ? ' is-open' : '' }${ hasError ? ' has-error' : '' }` }
						>
							<div className="cinq-repeater__head">
								<button
									type="button"
									className="cinq-repeater__toggle"
									aria-expanded={ open === index }
									onClick={ () =>
										setOpen( open === index ? null : index )
									}
								>
									<span className="cinq-repeater__index">
										{ String( index + 1 ).padStart(
											2,
											'0'
										) }
									</span>
									<span className="cinq-repeater__summary">
										{ summaryOf( row ) ||
											__(
												'Empty item',
												'cinq-wp-editor'
											) }
									</span>
								</button>
								<RowMenu
									label={ sprintf(
										/* translators: %d: Position of the row. */
										__( 'item %d', 'cinq-wp-editor' ),
										index + 1
									) }
									onDuplicate={
										max > 0 && rows.length >= max
											? null
											: () => duplicate( index )
									}
									onUp={
										index === 0
											? null
											: () => move( index, -1 )
									}
									onDown={
										index === rows.length - 1
											? null
											: () => move( index, 1 )
									}
									onRemove={
										rows.length <= min
											? null
											: () => remove( index )
									}
								/>
							</div>
							{ open === index && (
								<div className="cinq-repeater__body">
									<Fields
										fields={ field.sub_fields }
										value={ row }
										onChange={ ( next ) =>
											update( index, next )
										}
										path={ rowPath }
										errors={ errors }
									/>
								</div>
							) }
						</li>
					);
				} ) }
			</ol>
			<Button
				variant="secondary"
				size="compact"
				icon={ plus }
				disabled={ max > 0 && rows.length >= max }
				onClick={ add }
			>
				{ field.button_label || __( 'Add an item', 'cinq-wp-editor' ) }
			</Button>
			{ errorsAt( errors, path ).map( ( message, index ) => (
				<p key={ index } className="cinq-error">
					{ message }
				</p>
			) ) }
		</fieldset>
	);
}

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

function BlockList( {
	sections,
	sectionsTitle,
	fields,
	items,
	layouts,
	selected,
	hovered,
	errors,
	onSelect,
	onHover,
	onMove,
	onRemove,
	onDuplicate,
	onAdd,
} ) {
	const [ dragging, setDragging ] = useState( null );
	const [ over, setOver ] = useState( null );

	return (
		<aside
			id="cinq-wp-editor-blocks"
			role="region"
			tabIndex="-1"
			className="cinq-panel cinq-blocks"
			aria-label={ __( 'Blocks of the page', 'cinq-wp-editor' ) }
		>
			{ sections.length > 0 && (
				<>
					<h2 className="cinq-panel__title">{ sectionsTitle }</h2>
					<ul className="cinq-blocks__list is-fixed">
						{ sections.map( ( section ) => {
							const classes = [ 'cinq-blocks__item', 'is-fixed' ];
							if ( section.key === selected ) {
								classes.push( 'is-selected' );
							}
							if ( section.key === hovered ) {
								classes.push( 'is-hovered' );
							}
							if (
								errors.some( ( error ) =>
									holds( section, error.path )
								)
							) {
								classes.push( 'has-error' );
							}
							return (
								<li
									key={ section.key }
									className={ classes.join( ' ' ) }
									onMouseEnter={ () =>
										onHover( { section: section.key } )
									}
									onMouseLeave={ () =>
										onHover( { index: null } )
									}
								>
									<button
										type="button"
										className="cinq-blocks__select"
										onClick={ () =>
											onSelect( section.key )
										}
										aria-current={
											section.key === selected
												? 'true'
												: undefined
										}
									>
										<span className="cinq-blocks__label">
											{ section.title }
										</span>
										<span className="cinq-blocks__summary">
											{ summaryOf(
												valuesOf( section, fields )
											) || ' ' }
										</span>
									</button>
								</li>
							);
						} ) }
					</ul>
				</>
			) }
			<h2 className="cinq-panel__title">
				{ __( 'Blocks', 'cinq-wp-editor' ) }
				<span className="cinq-count">{ items.length }</span>
			</h2>
			<ol className="cinq-blocks__list">
				{ items.map( ( item, index ) => {
					const layout = layouts[ item.block.acf_fc_layout ];
					const hasError =
						errorsUnder( errors, `blocks[${ index }]` ).length > 0;
					const classes = [ 'cinq-blocks__item' ];
					if ( item.uid === selected ) {
						classes.push( 'is-selected' );
					}
					if ( index === hovered ) {
						classes.push( 'is-hovered' );
					}
					if ( index === dragging ) {
						classes.push( 'is-dragging' );
					}
					if (
						over === index &&
						dragging !== null &&
						dragging !== index
					) {
						classes.push(
							dragging < index
								? 'is-over-after'
								: 'is-over-before'
						);
					}
					if ( hasError ) {
						classes.push( 'has-error' );
					}
					return (
						<li
							key={ item.uid }
							className={ classes.join( ' ' ) }
							draggable
							onDragStart={ ( event ) => {
								event.dataTransfer.effectAllowed = 'move';
								event.dataTransfer.setData(
									'text/plain',
									String( index )
								);
								setDragging( index );
							} }
							onDragOver={ ( event ) => {
								event.preventDefault();
								setOver( index );
							} }
							onDrop={ ( event ) => {
								event.preventDefault();
								if ( dragging !== null && dragging !== index ) {
									onMove( dragging, index );
								}
								setDragging( null );
								setOver( null );
							} }
							onDragEnd={ () => {
								setDragging( null );
								setOver( null );
							} }
							onMouseEnter={ () => onHover( { index } ) }
							onMouseLeave={ () => onHover( { index: null } ) }
						>
							<span className="cinq-blocks__grip" aria-hidden>
								<Icon icon={ dragHandle } size={ 24 } />
							</span>
							<button
								type="button"
								className="cinq-blocks__select"
								onClick={ () => onSelect( item.uid ) }
								aria-current={
									item.uid === selected ? 'true' : undefined
								}
							>
								<span className="cinq-blocks__label">
									{ layout
										? layout.label
										: item.block.acf_fc_layout }
								</span>
								<span className="cinq-blocks__summary">
									{ summaryOf( item.block ) || ' ' }
								</span>
							</button>
							<span className="cinq-blocks__actions">
								<RowMenu
									label={
										layout
											? layout.label
											: item.block.acf_fc_layout
									}
									onDuplicate={ () => onDuplicate( index ) }
									onUp={
										index === 0
											? null
											: () => onMove( index, index - 1 )
									}
									onDown={
										index === items.length - 1
											? null
											: () => onMove( index, index + 1 )
									}
									onRemove={ () => onRemove( index ) }
								/>
							</span>
						</li>
					);
				} ) }
			</ol>
			<div className="cinq-blocks__add">
				<Button variant="secondary" icon={ plus } onClick={ onAdd }>
					{ __( 'Add a block', 'cinq-wp-editor' ) }
				</Button>
			</div>
		</aside>
	);
}

/**
 * The settings of what is selected: a block, or a fixed section.
 *
 * @param {Object}                   props          Props.
 * @param {?string}                  props.id       Block uid or section key, null when nothing is selected.
 * @param {string}                   props.path     Editor path of the values.
 * @param {?Object}                  props.layout   Label, description, guidance and fields; null when the theme has no such block.
 * @param {string}                   props.missing  Block type the theme no longer has.
 * @param {Object}                   props.values   Values, keyed by field name.
 * @param {string}                   props.label    Name of the settings region.
 * @param {Object[]}                 props.errors   Errors of the page.
 * @param {(values: Object) => void} props.onChange Called with the new values.
 */
function Inspector( {
	id,
	path,
	layout,
	missing,
	values,
	label,
	errors,
	onChange,
} ) {
	// Panels the user opened or closed, by block and field: their choice
	// stands. Otherwise a panel opens when one of its fields is in error.
	const [ toggled, setToggled ] = useState( {} );

	if ( ! id ) {
		return (
			<aside
				id="cinq-wp-editor-inspector"
				role="region"
				tabIndex="-1"
				className="cinq-panel cinq-inspector is-empty"
				aria-label={ __( 'Block settings', 'cinq-wp-editor' ) }
			>
				<p>
					{ __(
						'Select a block, in the list or right on the page, to edit its content.',
						'cinq-wp-editor'
					) }
				</p>
			</aside>
		);
	}

	const own = errorsAt( errors, path );

	if ( ! layout ) {
		return (
			<aside
				id="cinq-wp-editor-inspector"
				role="region"
				tabIndex="-1"
				className="cinq-panel cinq-inspector"
				aria-label={ label }
			>
				<Notice status="warning" isDismissible={ false }>
					{ sprintf(
						/* translators: %s: Block type. */
						__(
							'The theme no longer has a “%s” block type.',
							'cinq-wp-editor'
						),
						missing
					) }
				</Notice>
			</aside>
		);
	}

	const setField = ( name, next ) =>
		onChange( { ...values, [ name ]: next } );

	return (
		<aside
			id="cinq-wp-editor-inspector"
			role="region"
			tabIndex="-1"
			className="cinq-panel cinq-inspector"
			aria-label={ label }
		>
			<header className="cinq-inspector__head">
				<h2 className="cinq-panel__title">{ layout.label }</h2>
				{ layout.description && (
					<p className="cinq-help">{ layout.description }</p>
				) }
				{ layout.guidance && (
					<p className="cinq-guidance">{ layout.guidance }</p>
				) }
			</header>
			{ own.map( ( message, position ) => (
				<Notice key={ position } status="error" isDismissible={ false }>
					{ message }
				</Notice>
			) ) }
			{
				// One panel per top-level field, in the theme's order: a group
				// shows its fields, anything else (a repeater) shows itself.
				layout.fields
					.filter( ( field ) =>
						isVisible( field, layout.fields, values )
					)
					.map( ( field, position ) => {
						const panel = `${ id }-${ field.key || field.name }`;
						const hasError =
							errorsUnder( errors, `${ path }.${ field.name }` )
								.length > 0;

						return (
							<PanelBody
								key={ panel }
								opened={
									toggled[ panel ] ??
									( hasError ||
										( field.name !== 'layout' &&
											position < 2 ) )
								}
								onToggle={ ( next ) =>
									setToggled( ( current ) => ( {
										...current,
										[ panel ]: next,
									} ) )
								}
								title={
									<>
										{ field.label }
										{ hasError ? (
											<span
												className="cinq-dot"
												aria-label={ __(
													'Error',
													'cinq-wp-editor'
												) }
											/>
										) : null }
									</>
								}
							>
								{ field.type === 'group' ? (
									<>
										{ field.instructions && (
											<p className="cinq-help">
												{ field.instructions }
											</p>
										) }
										<Fields
											fields={ field.sub_fields }
											value={ values[ field.name ] }
											onChange={ ( next ) =>
												setField( field.name, next )
											}
											path={ `${ path }.${ field.name }` }
											errors={ errors }
										/>
									</>
								) : (
									<Field
										field={ field }
										value={ values[ field.name ] }
										onChange={ ( next ) =>
											setField( field.name, next )
										}
										path={ `${ path }.${ field.name }` }
										errors={ errors }
									/>
								) }
							</PanelBody>
						);
					} )
			}
		</aside>
	);
}

function BlockPicker( { layouts, onPick, onClose } ) {
	const [ query, setQuery ] = useState( '' );
	const needle = query.trim().toLowerCase();
	const offered = layouts.filter(
		( layout ) =>
			layout.offered &&
			( ! needle ||
				`${ layout.label } ${ layout.description }`
					.toLowerCase()
					.includes( needle ) )
	);

	return (
		<Modal
			title={ __( 'Add a block', 'cinq-wp-editor' ) }
			onRequestClose={ onClose }
			className="cinq-picker"
			size="large"
		>
			<SearchControl
				value={ query }
				onChange={ setQuery }
				placeholder={ __( 'Search blocks…', 'cinq-wp-editor' ) }
				__nextHasNoMarginBottom
			/>
			<ul className="cinq-picker__list">
				{ offered.map( ( layout ) => (
					<li key={ layout.name }>
						<button
							type="button"
							className="cinq-picker__item"
							onClick={ () => onPick( layout.name ) }
						>
							<strong>{ layout.label }</strong>
							{ layout.description && (
								<span>{ layout.description }</span>
							) }
						</button>
					</li>
				) ) }
			</ul>
			{ ! offered.length && (
				<p>{ __( 'No block matches.', 'cinq-wp-editor' ) }</p>
			) }
		</Modal>
	);
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

function App() {
	const [ state, setState ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ items, setItems ] = useState( [] );
	// Values of the fixed sections, keyed by field name.
	const [ fields, setFields ] = useState( {} );
	// A block's uid or a fixed section's key.
	const [ selected, setSelected ] = useState( null );
	const [ hovered, setHovered ] = useState( null );
	const [ errors, setErrors ] = useState( [] );
	const [ confirm, setConfirm ] = useState( null );
	const [ status, setStatus ] = useState( 'idle' );
	const [ changed, setChanged ] = useState( false );
	const [ picker, setPicker ] = useState( false );
	// The side panels, as the block editor lets one close its list view and settings.
	const { blocksOpen, inspectorOpen } = useSelect(
		( select ) => ( {
			blocksOpen: select( preferencesStore ).get(
				PREFERENCES,
				'blocksOpen'
			),
			inspectorOpen: select( preferencesStore ).get(
				PREFERENCES,
				'inspectorOpen'
			),
		} ),
		[]
	);
	const { toggle: togglePreference } = useDispatch( preferencesStore );
	const toggleBlocks = () => togglePreference( PREFERENCES, 'blocksOpen' );
	const toggleInspector = () =>
		togglePreference( PREFERENCES, 'inspectorOpen' );
	const [ device, setDevice ] = useState( 'desktop' );
	// Notices as the block editor shows them: a banner for what needs
	// attention, a snackbar for what went well. A fixed id per kind makes a
	// new notice replace the previous one instead of piling up.
	const notices = useSelect(
		( select ) => select( noticesStore ).getNotices( NOTICES ),
		[]
	);
	const { createNotice, removeNotice } = useDispatch( noticesStore );
	const say = useCallback(
		( kind, content, options ) =>
			createNotice( kind, content, { context: NOTICES, ...options } ),
		[ createNotice ]
	);
	const forget = useCallback(
		( id ) => removeNotice( id, NOTICES ),
		[ removeNotice ]
	);

	const frame = useRef( null );
	const itemsRef = useRef( items );
	const fieldsRef = useRef( fields );
	const timer = useRef( 0 );
	const inFlight = useRef( false );
	const publishAfterSave = useRef( false );
	// WordPress's post lock: held while the page is open here, or someone else's.
	const lockValue = useRef( config.lock.value );
	const [ locked, setLocked ] = useState(
		config.lock.holder ? { ...config.lock.holder, takenOver: false } : null
	);
	const again = useRef( false );
	const pending = useRef( false );
	const dirty = useRef( new Set() );
	// A fixed section changed: no template renders one alone, the page reloads.
	const reload = useRef( false );
	const scrollOnSelect = useRef( false );
	const scrollAfterRender = useRef( false );
	const selectedRef = useRef( selected );

	itemsRef.current = items;
	fieldsRef.current = fields;
	selectedRef.current = selected;

	const layouts = useMemo( () => {
		const byName = {};
		( state ? state.layouts : [] ).forEach(
			( layout ) => ( byName[ layout.name ] = layout )
		);
		return byName;
	}, [ state ] );

	const labels = items.map(
		( item ) =>
			( layouts[ item.block.acf_fc_layout ] || {} ).label ||
			item.block.acf_fc_layout
	);
	const sections = state ? state.sections : [];
	const selectedSection = sections.find(
		( section ) => section.key === selected
	);
	const selectedIndex = items.findIndex( ( item ) => item.uid === selected );
	const labelsRef = useRef( labels );
	const sectionLabels = Object.fromEntries(
		sections.map( ( section ) => [ section.key, section.title ] )
	);
	const sectionLabelsRef = useRef( sectionLabels );
	const order = items.map( ( item ) => item.uid );

	labelsRef.current = labels;
	sectionLabelsRef.current = sectionLabels;

	// Reads the labels from a ref: a save scheduled several renders ago
	// must still send the current ones.
	const toFrame = useCallback( ( message ) => {
		const target = frame.current && frame.current.contentWindow;

		if ( target ) {
			target.postMessage(
				{
					source: 'cinq-wp-editor',
					labels: labelsRef.current,
					sectionLabels: sectionLabelsRef.current,
					...message,
				},
				ORIGIN
			);
		}
	}, [] );

	/* Load */

	useEffect( () => {
		apiFetch( { path: API } )
			.then( ( data ) => {
				const content = data.draft || data.published;

				setState( data );
				setItems(
					content.blocks.map( ( block ) => ( { uid: uid(), block } ) )
				);
				setFields( content.fields );
				setChanged( Boolean( data.draft ) );

				if ( data.draft ) {
					say(
						'info',
						__(
							'You are back on your draft: it is not published yet.',
							'cinq-wp-editor'
						),
						{ id: 'draft' }
					);
				}
			} )
			.catch( ( error ) =>
				setLoadError(
					messageOf(
						error,
						__(
							'This content could not be opened.',
							'cinq-wp-editor'
						)
					)
				)
			);
	}, [ say ] );

	/* Messages from the preview */

	useEffect( () => {
		const listen = ( event ) => {
			const data = event.data;

			if (
				event.origin !== ORIGIN ||
				! data ||
				data.source !== 'cinq-wp-editor-preview'
			) {
				return;
			}

			if ( data.type === 'ready' ) {
				// The template of the page renders no block zone: changes would show nowhere.
				if ( data.blocks === false ) {
					say(
						'warning',
						__(
							'The template of this page does not render its blocks: your changes will not show there.',
							'cinq-wp-editor'
						),
						{
							id: 'unrendered',
							isDismissible: false,
							actions: [
								{
									label: __(
										'Edit in the classic editor',
										'cinq-wp-editor'
									),
									url: state.post.editUrl,
								},
							],
						}
					);
				} else {
					forget( 'unrendered' );
				}

				// The preview has no admin color scheme: lend it the editor's.
				toFrame( {
					type: 'theme',
					rgb: window
						.getComputedStyle( document.body )
						.getPropertyValue( '--wp-admin-theme-color--rgb' )
						.trim(),
				} );

				const index = itemsRef.current.findIndex(
					( item ) => item.uid === selected
				);
				toFrame( {
					type: 'order',
					uids: itemsRef.current.map( ( item ) => item.uid ),
				} );
				toFrame( {
					type: 'select',
					index: index < 0 ? null : index,
					section: selectedSection ? selectedSection.key : null,
				} );
			}

			if ( data.type === 'select' ) {
				const item = itemsRef.current[ data.index ];
				scrollOnSelect.current = false;
				setSelected( data.section || ( item ? item.uid : null ) );
			}

			if ( data.type === 'hover' ) {
				setHovered( data.section ?? data.index );
			}

			if ( data.type === 'save' ) {
				requestPublish();
			}
		};

		window.addEventListener( 'message', listen );
		return () => window.removeEventListener( 'message', listen );
	} );

	useEffect( () => {
		toFrame( {
			type: 'select',
			index: selectedIndex < 0 ? null : selectedIndex,
			section: selectedSection ? selectedSection.key : null,
			scroll: scrollOnSelect.current,
		} );
		scrollOnSelect.current = false;
	}, [ selected, selectedIndex, selectedSection, toFrame ] );

	const labelsKey = labels.join( '|' );
	const orderKey = JSON.stringify( order );

	useEffect( () => {
		toFrame( { type: 'labels' } );
	}, [ labelsKey, toFrame ] );

	// Moves and removals show at once: the preview reorders its own
	// blocks, nothing is fetched.
	useEffect( () => {
		toFrame( { type: 'order', uids: JSON.parse( orderKey ) } );
	}, [ orderKey, toFrame ] );

	/* Saving */

	/**
	 * Saves the draft and gets back, in the same request, the HTML of the
	 * blocks whose fields changed or that were just added.
	 */
	async function flush() {
		if ( inFlight.current ) {
			again.current = true;
			return;
		}

		inFlight.current = true;

		const snapshot = itemsRef.current;
		const render = Array.from( dirty.current )
			.map( ( uidToRender ) =>
				snapshot.findIndex( ( item ) => item.uid === uidToRender )
			)
			.filter( ( index ) => index >= 0 );

		const reloadPage = reload.current;

		dirty.current.clear();
		reload.current = false;
		pending.current = false;
		setStatus( 'saving' );

		try {
			const response = await apiFetch( {
				path: `${ API }/draft`,
				method: 'PUT',
				data: {
					blocks: snapshot.map( ( item ) => item.block ),
					fields: fieldsRef.current,
					render,
				},
			} );
			const html = response.html || {};
			let fallback = false;

			render.forEach( ( index ) => {
				if ( html[ index ] ) {
					toFrame( {
						type: 'replace',
						uid: snapshot[ index ].uid,
						html: html[ index ],
					} );
				} else {
					fallback = true;
				}
			} );

			// A fixed section changed: the page again, scrolled where it was.
			// A block the server could not render alone: all the blocks.
			if ( reloadPage ) {
				frame.current.contentWindow.location.reload();
			} else if ( fallback ) {
				toFrame( { type: 'refresh' } );
			}

			if ( scrollAfterRender.current ) {
				const index = snapshot.findIndex(
					( item ) => item.uid === selectedRef.current
				);
				scrollAfterRender.current = false;
				toFrame( {
					type: 'select',
					index: index < 0 ? null : index,
					scroll: true,
				} );
			}

			setErrors( response.errors || [] );
			setStatus( 'saved' );
			forget( 'save' );
		} catch ( error ) {
			setStatus( 'error' );
			say(
				'error',
				messageOf(
					error,
					__( 'The draft could not be saved.', 'cinq-wp-editor' )
				),
				{ id: 'save' }
			);
		}

		inFlight.current = false;

		// ⌘S during a save: publish once it is done, with what is there now.
		if ( publishAfterSave.current ) {
			publishAfterSave.current = false;
			again.current = false;
			publish();
			return;
		}

		if ( again.current ) {
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
	 *
	 * @param {Object[]} nextItems Blocks after the change.
	 * @param {?string}  renderUid Block the preview needs again from the server, or null.
	 */
	function commit( nextItems, renderUid ) {
		if ( renderUid ) {
			dirty.current.add( renderUid );
		}

		itemsRef.current = nextItems;

		setItems( nextItems );
		schedule();
	}

	/**
	 * Applies a change to the fixed sections, then saves after a pause.
	 *
	 * @param {Object} nextFields Values of every section, keyed by field name.
	 */
	function commitFields( nextFields ) {
		reload.current = true;
		fieldsRef.current = nextFields;

		setFields( nextFields );
		schedule();
	}

	/**
	 * Marks the page changed, and saves the draft after a pause.
	 */
	function schedule() {
		pending.current = true;

		setChanged( true );
		clearTimeout( timer.current );
		timer.current = setTimeout( flush, SAVE_DELAY );
	}

	useEffect( () => {
		const warn = ( event ) => {
			if ( pending.current || inFlight.current ) {
				event.preventDefault();
				event.returnValue = '';
			}
		};

		window.addEventListener( 'beforeunload', warn );
		return () => window.removeEventListener( 'beforeunload', warn );
	}, [] );

	/* Block operations */

	const updateBlock = ( uidToUpdate, block ) =>
		commit(
			itemsRef.current.map( ( item ) =>
				item.uid === uidToUpdate ? { ...item, block } : item
			),
			uidToUpdate
		);

	const moveBlock = ( from, to ) => {
		if ( to < 0 || to >= itemsRef.current.length ) {
			return;
		}
		const next = itemsRef.current.slice();
		const [ item ] = next.splice( from, 1 );
		next.splice( to, 0, item );
		commit( next, null );
	};

	const removeBlock = ( index ) => {
		const item = itemsRef.current[ index ];

		setConfirm( {
			title: __( 'Delete the block?', 'cinq-wp-editor' ),
			text: sprintf(
				/* translators: %s: Block name. */
				__(
					'The “%s” block will be removed from the page. You can still discard the draft to get it back.',
					'cinq-wp-editor'
				),
				labels[ index ]
			),
			label: __( 'Delete', 'cinq-wp-editor' ),
			action: () => {
				commit(
					itemsRef.current.filter( ( other ) => other !== item ),
					null
				);
				setSelected( ( current ) =>
					current === item.uid ? null : current
				);
			},
		} );
	};

	const duplicateBlock = ( index ) => {
		const twin = {
			uid: uid(),
			block: copy( itemsRef.current[ index ].block ),
		};
		const next = itemsRef.current.slice();

		next.splice( index + 1, 0, twin );
		scrollAfterRender.current = true;
		selectedRef.current = twin.uid;
		commit( next, twin.uid );
		setSelected( twin.uid );
	};

	const addBlock = ( name ) => {
		const layout = layouts[ name ];
		const fresh = {
			uid: uid(),
			block: { acf_fc_layout: name, ...defaultsFor( layout.fields ) },
		};
		const next = itemsRef.current.slice();
		const at = selectedIndex < 0 ? next.length : selectedIndex + 1;

		next.splice( at, 0, fresh );
		scrollAfterRender.current = true;
		selectedRef.current = fresh.uid;
		commit( next, fresh.uid );
		setPicker( false );
		setSelected( fresh.uid );
	};

	const selectFromList = ( uidToSelect ) => {
		scrollOnSelect.current = true;
		setSelected( uidToSelect );
	};

	/* Publish and discard */

	/**
	 * Publishes, or waits for the draft being saved: publishing alongside
	 * it could see the draft written again once published.
	 */
	function requestPublish() {
		if ( ! changed || status === 'publishing' || locked ) {
			return;
		}

		if ( inFlight.current ) {
			publishAfterSave.current = true;
			return;
		}

		publish();
	}

	async function publish() {
		// Changes not saved yet were not rendered either: the page, after.
		const stale = dirty.current.size > 0;
		const reloadPage = reload.current;

		clearTimeout( timer.current );
		setStatus( 'publishing' );
		forget( 'publish' );

		try {
			const response = await apiFetch( {
				path: `${ API }/publish`,
				method: 'POST',
				data: {
					blocks: itemsRef.current.map( ( item ) => item.block ),
					fields: fieldsRef.current,
				},
			} );

			pending.current = false;
			dirty.current.clear();
			reload.current = false;
			setErrors( [] );
			setChanged( false );
			setStatus( 'idle' );
			setState( ( current ) => ( {
				...current,
				published: response.published,
				draft: null,
			} ) );

			if ( reloadPage ) {
				frame.current.contentWindow.location.reload();
			} else if ( stale ) {
				toFrame( { type: 'refresh' } );
			}
			const live = state.post.status === 'publish';

			forget( 'draft' );
			say(
				'success',
				live
					? __(
							'Page published: the live page is up to date.',
							'cinq-wp-editor'
						)
					: __( 'Page saved.', 'cinq-wp-editor' ),
				{
					id: 'publish',
					type: 'snackbar',
					actions: live
						? [
								{
									label: __(
										'View the page',
										'cinq-wp-editor'
									),
									url: state.post.viewUrl,
								},
							]
						: [],
				}
			);
		} catch ( error ) {
			const invalid = ( error.data && error.data.errors ) || [];
			const firstPath = invalid.length ? invalid[ 0 ].path : '';
			const block = /^blocks\[(\d+)\]/.exec( firstPath );
			const item = block
				? itemsRef.current[ Number( block[ 1 ] ) ]
				: null;
			const section = state.sections.find( ( candidate ) =>
				holds( candidate, firstPath )
			);
			const first = item ? item.uid : section && section.key;
			const count = invalid.length
				? ' ' +
					sprintf(
						/* translators: %d: Number of invalid fields. */
						_n(
							'(%d field to fix)',
							'(%d fields to fix)',
							invalid.length,
							'cinq-wp-editor'
						),
						invalid.length
					)
				: '';

			setStatus( 'error' );
			setErrors( invalid );
			say(
				'error',
				messageOf(
					error,
					__( 'Publishing failed.', 'cinq-wp-editor' )
				) + count,
				{
					id: 'publish',
					actions: first
						? [
								{
									label: __(
										'Show the first one',
										'cinq-wp-editor'
									),
									onClick: () => selectFromList( first ),
								},
							]
						: [],
				}
			);
		}
	}

	function discard() {
		setConfirm( {
			title: __( 'Discard the draft?', 'cinq-wp-editor' ),
			text: __(
				'Your unpublished changes will be lost: the page goes back to its published version.',
				'cinq-wp-editor'
			),
			label: __( 'Discard', 'cinq-wp-editor' ),
			action: dropDraft,
		} );
	}

	async function dropDraft() {
		clearTimeout( timer.current );
		pending.current = false;
		dirty.current.clear();
		reload.current = false;

		try {
			await apiFetch( { path: `${ API }/draft`, method: 'DELETE' } );
			setItems(
				state.published.blocks.map( ( block ) => ( {
					uid: uid(),
					block,
				} ) )
			);
			setFields( state.published.fields );
			setSelected( null );
			setErrors( [] );
			setChanged( false );
			setStatus( 'idle' );
			[ 'draft', 'save', 'publish' ].forEach( forget );
			say(
				'info',
				__(
					'Draft discarded: the page is back to its published version.',
					'cinq-wp-editor'
				),
				{ id: 'discard', type: 'snackbar' }
			);
			frame.current.contentWindow.location.reload();
		} catch ( error ) {
			say(
				'error',
				messageOf(
					error,
					__( 'The draft could not be discarded.', 'cinq-wp-editor' )
				),
				{ id: 'discard' }
			);
		}
	}

	/* Post lock */

	/**
	 * Keeps the lock with the edit screen's own heartbeat: every ten
	 * seconds the lock is renewed, or WordPress says who took it over. On
	 * leaving, the lock is given back as the edit screen gives it back.
	 */
	useEffect( () => {
		const $ = window.jQuery;

		if ( ! $ || ! heartbeat ) {
			return;
		}

		heartbeat.interval( 10 );

		const send = ( event, data ) => {
			if ( lockValue.current ) {
				data[ 'wp-refresh-post-lock' ] = {
					post_id: config.postId,
					lock: lockValue.current,
				};
			}
		};

		const tick = ( event, data ) => {
			const received = data[ 'wp-refresh-post-lock' ];

			if ( ! received ) {
				return;
			}

			if ( received.lock_error ) {
				lockValue.current = '';
				setLocked( {
					text: received.lock_error.text,
					avatar:
						received.lock_error.avatar_src_2x ||
						received.lock_error.avatar_src ||
						'',
					takenOver: true,
				} );
			} else if ( received.new_lock ) {
				lockValue.current = received.new_lock;
			}
		};

		const release = () => {
			if ( ! lockValue.current ) {
				return;
			}

			const body = new FormData();

			body.append( 'action', 'wp-remove-post-lock' );
			body.append( '_wpnonce', config.lock.nonce );
			body.append( 'post_ID', String( config.postId ) );
			body.append( 'active_post_lock', lockValue.current );
			navigator.sendBeacon( config.lock.ajaxUrl, body );
		};

		$( document )
			.on( 'heartbeat-send.cinq-wp-editor', send )
			.on( 'heartbeat-tick.cinq-wp-editor', tick );
		window.addEventListener( 'pagehide', release );

		return () => {
			$( document ).off( '.cinq-wp-editor' );
			window.removeEventListener( 'pagehide', release );
		};
	}, [] );

	/* Shortcuts and commands */

	useEffect( () => {
		dispatch( keyboardShortcutsStore ).registerShortcut( {
			name: 'cinq-wp-editor/save',
			category: 'global',
			description: __( 'Publish the changes.', 'cinq-wp-editor' ),
			keyCombination: { modifier: 'primary', character: 's' },
		} );
	}, [] );

	useShortcut( 'cinq-wp-editor/save', ( event ) => {
		event.preventDefault();
		requestPublish();
	} );

	// The panels' visibility is the root's, which holds the grid.
	useEffect( () => {
		const root = document.getElementById( 'cinq-wp-editor' );

		root.classList.toggle( 'is-blocks-hidden', ! blocksOpen );
		root.classList.toggle( 'is-inspector-hidden', ! inspectorOpen );
	}, [ blocksOpen, inspectorOpen ] );

	const live = Boolean( state && state.post.status === 'publish' );
	const run =
		( action ) =>
		( { close } ) => {
			close();
			action();
		};

	useCommand( {
		name: 'cinq-wp-editor/add-block',
		label: __( 'Add a block', 'cinq-wp-editor' ),
		icon: plus,
		callback: run( () => setPicker( true ) ),
		disabled: ! state,
	} );
	useCommand( {
		name: 'cinq-wp-editor/publish',
		label: live
			? __( 'Publish the changes', 'cinq-wp-editor' )
			: __( 'Save the page', 'cinq-wp-editor' ),
		icon: upload,
		callback: run( requestPublish ),
		disabled: ! changed || Boolean( locked ),
	} );
	useCommand( {
		name: 'cinq-wp-editor/discard',
		label: __( 'Discard the draft', 'cinq-wp-editor' ),
		icon: undo,
		callback: run( discard ),
		disabled: ! changed,
	} );
	useCommand( {
		name: 'cinq-wp-editor/blocks',
		label: blocksOpen
			? __( 'Hide the list of blocks', 'cinq-wp-editor' )
			: __( 'Show the list of blocks', 'cinq-wp-editor' ),
		icon: listView,
		callback: run( toggleBlocks ),
	} );
	useCommand( {
		name: 'cinq-wp-editor/inspector',
		label: inspectorOpen
			? __( 'Hide the settings', 'cinq-wp-editor' )
			: __( 'Show the settings', 'cinq-wp-editor' ),
		icon: drawerRight,
		callback: run( toggleInspector ),
	} );
	useCommand( {
		name: 'cinq-wp-editor/device-desktop',
		label: __( 'Preview: desktop', 'cinq-wp-editor' ),
		icon: desktop,
		callback: run( () => setDevice( 'desktop' ) ),
		disabled: device === 'desktop',
	} );
	useCommand( {
		name: 'cinq-wp-editor/device-tablet',
		label: __( 'Preview: tablet', 'cinq-wp-editor' ),
		icon: tablet,
		callback: run( () => setDevice( 'tablet' ) ),
		disabled: device === 'tablet',
	} );
	useCommand( {
		name: 'cinq-wp-editor/device-mobile',
		label: __( 'Preview: mobile', 'cinq-wp-editor' ),
		icon: mobile,
		callback: run( () => setDevice( 'mobile' ) ),
		disabled: device === 'mobile',
	} );
	useCommand( {
		name: 'cinq-wp-editor/classic',
		label: __( 'Edit in the classic editor', 'cinq-wp-editor' ),
		icon: pencil,
		callback: run( () => window.location.assign( state.post.editUrl ) ),
		disabled: ! state,
	} );
	useCommand( {
		name: 'cinq-wp-editor/view',
		label: __( 'View the page', 'cinq-wp-editor' ),
		icon: external,
		callback: run( () => window.open( state.post.viewUrl, '_blank' ) ),
		disabled: ! live,
	} );

	/* Render */

	if ( loadError ) {
		return (
			<div className="cinq-wp-editor__fatal">
				<Notice status="error" isDismissible={ false }>
					{ loadError }
				</Notice>
			</div>
		);
	}

	if ( ! state ) {
		return (
			<div className="cinq-wp-editor__loading">
				<Spinner />
			</div>
		);
	}

	const statusText = {
		idle: changed
			? __( 'Unpublished changes', 'cinq-wp-editor' )
			: __( 'Up to date', 'cinq-wp-editor' ),
		saving: __( 'Saving the draft…', 'cinq-wp-editor' ),
		saved: changed
			? __( 'Draft saved', 'cinq-wp-editor' )
			: __( 'Up to date', 'cinq-wp-editor' ),
		publishing: __( 'Publishing…', 'cinq-wp-editor' ),
		error: __( 'Error', 'cinq-wp-editor' ),
	}[ status ];

	const isPublished = state.post.status === 'publish';
	const selectedItem = items[ selectedIndex ];
	const selectedLayout = selectedItem
		? layouts[ selectedItem.block.acf_fc_layout ]
		: null;
	let inspected = { id: null };

	if ( selectedSection ) {
		inspected = {
			id: selectedSection.key,
			path: FIELDS,
			layout: {
				label: selectedSection.title,
				fields: selectedSection.fields,
			},
			values: fields,
			label: sprintf(
				/* translators: %s: Section name. */
				__( 'Settings of %s', 'cinq-wp-editor' ),
				selectedSection.title
			),
			onChange: commitFields,
		};
	} else if ( selectedItem ) {
		inspected = {
			id: selectedItem.uid,
			path: `blocks[${ selectedIndex }]`,
			layout: selectedLayout,
			missing: selectedItem.block.acf_fc_layout,
			values: selectedItem.block,
			label: selectedLayout
				? sprintf(
						/* translators: %s: Block name. */
						__( 'Settings of the %s block', 'cinq-wp-editor' ),
						selectedLayout.label
					)
				: __( 'Block settings', 'cinq-wp-editor' ),
			onChange: ( block ) => updateBlock( selectedItem.uid, block ),
		};
	}

	return (
		<>
			<header
				className="cinq-topbar"
				role="region"
				tabIndex="-1"
				aria-label={ __( 'Editor top bar', 'cinq-wp-editor' ) }
			>
				<div className="cinq-topbar__start">
					<Button
						icon={ arrowLeft }
						label={ __( 'Back to the list', 'cinq-wp-editor' ) }
						href={ state.post.listUrl }
					/>
					<Button
						icon={ listView }
						label={ __( 'List of blocks', 'cinq-wp-editor' ) }
						isPressed={ blocksOpen }
						aria-controls="cinq-wp-editor-blocks"
						onClick={ toggleBlocks }
					/>
					<div>
						<strong className="cinq-topbar__title">
							{ decodeEntities( state.post.title ) ||
								__( '(no title)', 'cinq-wp-editor' ) }
						</strong>
						<span className="cinq-topbar__type">
							{ state.post.typeLabel }
						</span>
					</div>
				</div>
				<div className="cinq-topbar__devices">
					<DropdownMenu
						icon={
							DEVICES.find(
								( choice ) => choice.value === device
							).icon
						}
						label={ __( 'Preview', 'cinq-wp-editor' ) }
						popoverProps={ {
							placement: 'bottom',
						} }
					>
						{ ( { onClose } ) => (
							<MenuGroup
								label={ __( 'Preview', 'cinq-wp-editor' ) }
							>
								<MenuItemsChoice
									choices={ DEVICES.map( ( choice ) => ( {
										value: choice.value,
										label: choice.label,
									} ) ) }
									value={ device }
									onSelect={ ( next ) => {
										setDevice( next );
										onClose();
									} }
								/>
							</MenuGroup>
						) }
					</DropdownMenu>
				</div>
				<div className="cinq-topbar__end">
					<span className={ `cinq-status is-${ status }` }>
						{ status === 'saving' || status === 'publishing' ? (
							<Spinner />
						) : null }
						{ statusText }
					</span>
					<Button variant="tertiary" href={ state.post.editUrl }>
						{ __( 'Classic editor', 'cinq-wp-editor' ) }
					</Button>
					{ changed && (
						<Button
							variant="tertiary"
							isDestructive
							onClick={ discard }
							disabled={ status === 'publishing' }
						>
							{ __( 'Discard', 'cinq-wp-editor' ) }
						</Button>
					) }
					<Button
						variant="primary"
						onClick={ requestPublish }
						disabled={
							! changed ||
							status === 'publishing' ||
							Boolean( locked )
						}
						isBusy={ status === 'publishing' }
					>
						{ isPublished
							? __( 'Publish', 'cinq-wp-editor' )
							: __( 'Save', 'cinq-wp-editor' ) }
					</Button>
					<Button
						icon={ drawerRight }
						label={ __( 'Settings', 'cinq-wp-editor' ) }
						isPressed={ inspectorOpen }
						aria-controls="cinq-wp-editor-inspector"
						onClick={ toggleInspector }
					/>
				</div>
			</header>
			<div className="cinq-notice">
				<NoticeList
					notices={ notices.filter(
						( item ) => item.type !== 'snackbar'
					) }
					onRemove={ forget }
				/>
			</div>
			<div className="cinq-snackbars">
				<SnackbarList
					notices={ notices.filter(
						( item ) => item.type === 'snackbar'
					) }
					onRemove={ forget }
				/>
			</div>
			<BlockList
				sections={ sections }
				sectionsTitle={ state.post.typeLabel }
				fields={ fields }
				items={ items }
				layouts={ layouts }
				selected={ selected }
				hovered={ hovered }
				errors={ errors }
				onSelect={ selectFromList }
				onHover={ ( target ) =>
					toFrame( {
						type: 'hover',
						...target,
					} )
				}
				onMove={ moveBlock }
				onRemove={ removeBlock }
				onDuplicate={ duplicateBlock }
				onAdd={ () => setPicker( true ) }
			/>
			<main
				className={ `cinq-stage is-${ device }` }
				role="region"
				tabIndex="-1"
				aria-label={ __( 'Page preview', 'cinq-wp-editor' ) }
			>
				<iframe
					ref={ frame }
					className="cinq-stage__frame"
					src={ state.post.previewUrl }
					title={ __( 'Page preview', 'cinq-wp-editor' ) }
				/>
			</main>
			<Inspector { ...inspected } errors={ errors } />
			{ locked && <LockedModal lock={ locked } post={ state.post } /> }
			{ picker && (
				<BlockPicker
					layouts={ state.layouts }
					onPick={ addBlock }
					onClose={ () => setPicker( false ) }
				/>
			) }
			{ confirm && (
				<Confirm
					{ ...confirm }
					onConfirm={ () => {
						setConfirm( null );
						confirm.action();
					} }
					onCancel={ () => setConfirm( null ) }
				/>
			) }
		</>
	);
}

const root = document.getElementById( 'cinq-wp-editor' );

if ( root ) {
	// Ctrl+` and Ctrl+Shift+` move between the regions, as in the block editor.
	const Editor = navigateRegions( App );

	createRoot( root ).render( <Editor /> );
}
