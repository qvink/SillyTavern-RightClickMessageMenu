import {
    getStringHash,
    debounce,
    copyText,
    trimToEndSentence,
    download,
    parseJsonFile,
    stringToRange,
    waitUntilCondition
} from '../../../utils.js';
import {saveSettingsDebounced, chat_metadata} from '../../../../script.js';
import { getContext, extension_settings} from '../../../extensions.js';
import { t, translate } from '../../../i18n.js';

export { MODULE_NAME };

// THe module name modifies where settings are stored, where information is stored on message objects, macros, etc.
const MODULE_NAME = 'right_click_message_menu';
const MODULE_NAME_FANCY = 'RCMM';


// Settings
const default_settings = {
    // inclusion criteria
    menu_mode: 'vertical',  // default vertical
    debug_mode: false,
    max_width_horizontal: 300
};
const settings_ui_map = {}  // map of settings to UI elements


// Utility functions
function log() {
    console.log(`[${MODULE_NAME_FANCY}]`, ...arguments);
}
function debug() {
    if (get_settings('debug_mode')) {
        log("[DEBUG]", ...arguments);
    }
}
function error() {
    console.error(`[${MODULE_NAME_FANCY}]`, ...arguments);
    toastr.error(Array.from(arguments).join(' '), MODULE_NAME_FANCY);
}
function toast(message, type="info") {
    // debounce the toast messages
    toastr[type](message, MODULE_NAME_FANCY);
}
function escape_string(text) {
    // escape control characters in the text
    if (!text) return text
    return text.replace(/[\x00-\x1F\x7F]/g, function(match) {
        // Escape control characters
        switch (match) {
          case '\n': return '\\n';
          case '\t': return '\\t';
          case '\r': return '\\r';
          case '\b': return '\\b';
          case '\f': return '\\f';
          default: return '\\x' + match.charCodeAt(0).toString(16).padStart(2, '0');
        }
    });
}
function unescape_string(text) {
    // given a string with escaped characters, unescape them
    if (!text) return text
    return text.replace(/\\[ntrbf0x][0-9a-f]{2}|\\[ntrbf]/g, function(match) {
        switch (match) {
          case '\\n': return '\n';
          case '\\t': return '\t';
          case '\\r': return '\r';
          case '\\b': return '\b';
          case '\\f': return '\f';
          default: {
            // Handle escaped hexadecimal characters like \\xNN
            const hexMatch = match.match(/\\x([0-9a-f]{2})/i);
            if (hexMatch) {
              return String.fromCharCode(parseInt(hexMatch[1], 16));
            }
            return match; // Return as is if no match
          }
        }
    });
}

// Settings Management
function initialize_settings() {
    if (extension_settings[MODULE_NAME] !== undefined) {  // setting already initialized
        log("Settings already initialized.")
        extension_settings[MODULE_NAME] = Object.assign(structuredClone(default_settings), extension_settings[MODULE_NAME]);
    } else {  // no settings present, first time initializing
        log("Extension settings not found. Initializing...")
        extension_settings[MODULE_NAME] = structuredClone({...default_settings});
    }
}
function set_settings(key, value, copy=false) {
    // Set a setting for the extension and save it
    if (copy) {
        value = structuredClone(value)
    }
    extension_settings[MODULE_NAME][key] = value;
    saveSettingsDebounced();
}
function get_settings(key, copy=false) {
    // Get a setting for the extension, or the default value if not set
    let value = extension_settings[MODULE_NAME]?.[key] ?? default_settings[key];
    if (copy) {  // needed when retrieving objects
        return structuredClone(value)
    } else {
        return value
    }

}
function get_extension_directory() {
    // get the directory of the extension
    let index_path = new URL(import.meta.url).pathname
    return index_path.substring(0, index_path.lastIndexOf('/'))  // remove the /index.js from the path
}
async function get_manifest() {
    // Get the manifest.json for the extension
    let module_dir = get_extension_directory();
    let path = `${module_dir}/manifest.json`
    let response = await fetch(path)
    if (response.ok) {
        return await response.json();
    }
    error(`Error getting manifest.json from "${path}": status: ${response.status}`);
}
async function load_settings_html() {
    // fetch the settings html file and append it to the settings div.
    log("Loading settings.html...")

    let module_dir = get_extension_directory()
    let path = `${module_dir}/settings.html`
    let found = await $.get(path).then(async response => {
        log(`Loaded settings.html at "${path}"`)
        $("#extensions_settings2").append(response);  // load html into the settings div
        return true
    }).catch((response) => {
        error(`Error getting settings.json from "${path}": status: ${response.status}`);
        return false
    })

    return new Promise(resolve => resolve(found))
}


/**
 * Bind a UI element to a setting.
 * @param selector {string} jQuery Selector for the UI element
 * @param key {string} Key of the setting
 * @param type {string} Type of the setting (number, boolean)
 * @param callback {function} Callback function to run when the setting is updated
 */
function bind_setting(selector, key, type=null, callback=null) {
    // Bind a UI element to a setting, so if the UI element changes, the setting is updated
    selector = `.right_click_message_menu_settings ${selector}`  // add the settings div to the selector
    let element = $(selector)
    settings_ui_map[key] = [element, type]

    // if no elements found, log error
    if (element.length === 0) {
        error(`No element found for selector [${selector}] for setting [${key}]`);
        return;
    }

    // default trigger for a settings update is on a "change" event (as opposed to an input event)
    let trigger = 'change';

    // Set the UI element to the current setting value
    set_setting_ui_element(key, element, type);

    // Make the UI element update the setting when changed
    element.on(trigger, function (event) {
        let value;
        if (type === 'number') {  // number input
            value = Number($(this).val());
        } else if (type === 'boolean') {  // checkbox
            value = Boolean($(this).prop('checked'));
        } else {  // text, dropdown, select2
            value = $(this).val();
            value = unescape_string(value)  // ensures values like "\n" are NOT escaped from input
        }

        // update the setting
        debug(`Setting Triggered: [${key}] [${value}]`)
        set_settings(key, value)

        // trigger callback if provided, passing the new value
        if (callback !== null) {
            callback(value);
        }

        // update all other settings UI elements
        refresh_settings()
    });
}
function set_setting_ui_element(key, element, type, disabled=false) {
    // Set a UI element to the current setting value
    let radio = false;
    if (element.is('input[type="radio"]')) {
        radio = true;
    }

    // get the setting value
    let setting_value = get_settings(key);
    if (type === "text") {
        setting_value = escape_string(setting_value)  // escape values like "\n"
    }

    // initialize the UI element with the setting value
    if (radio) {  // if a radio group, select the one that matches the setting value
        let selected = element.filter(`[value="${setting_value}"]`)
        if (selected.length === 0) {
            error(`Error: No radio button found for value [${setting_value}] for setting [${key}]`);
            return;
        }
        selected.prop('checked', true);
    } else {  // otherwise, set the value directly
        if (type === 'boolean') {  // checkbox
            element.prop('checked', setting_value);
        } else {  // text input or dropdown
            element.val(setting_value);
        }
    }

    element.prop('disabled', disabled)
}

function refresh_settings() {
    // Refresh all settings UI elements according to the current settings
    debug("Refreshing settings...")

    let menu_mode = get_settings('menu_mode')

    // iterate through the settings map and set each element to the current setting value
    for (let [key, [element, type]] of Object.entries(settings_ui_map)) {
        let disabled = false
        if (key === 'max_width_horizontal') disabled = menu_mode !== 'horizontal'
        set_setting_ui_element(key, element, type, disabled);
    }
}


var $menu;
const menu_id = "right_click_message_menu"
const vertical_menu_class = "right_click_message_menu_vertical"
const horizontal_menu_class = "right_click_message_menu_horizontal"
const horizontal_item_class = "right_click_message_menu_item"
const button_name_map = {  // mapping for some default button names
    "Exclude message from prompts": "Exclude from prompts"
}

function parse_tooltip(tooltip) {
    // In vertical mode, we want to have some short text to use for the menu text.
    // For some default buttons, we have a hard-coded mapping.
    // For others, many tooltips are long so we will instead parse out any text inside parentheses, use that as a tooltip, and use any remaining text as the item text.

    let text = tooltip
    let title = ""

    // if we have a mapping, use that
    let mapped = button_name_map[tooltip]
    if (mapped) {
        text = mapped
        title = tooltip
    } else {  // otherwise, parse any parentheses
        let idx = tooltip.search(/\(.*\)\s*$/)
        if (idx !== -1) {
            text = tooltip.slice(0, idx)
            title = tooltip.slice(idx).replace(/[()]/g, '')
        }
    }

    return {text: text, title: title}
}

function init_menu() {
    // If the menu already exists
    $menu = $(`#${menu_id}`)
    if ($menu.length === 0) {  // not initialized yet
        $menu = $(`<div id="${menu_id}" class="options-content popup" style="position: absolute; width: unset;"></div>`)
        $('body').append($menu)
    } else {  // already initialized - clear it
        $menu.empty()
    }

    // remove horizontal/vertical class
    $menu.removeClass([vertical_menu_class, horizontal_menu_class])

    // what menu mode we are using
    let menu_mode = get_settings('menu_mode')

    if (menu_mode === 'disabled') {  // If disabled, remove the menu and return
        $menu.remove()
        return
    } else if (menu_mode === 'horizontal') {
        $menu.css('max-width', `${get_settings('max_width_horizontal')}px`)  // set max width if in horizontal mode
        $menu.addClass(horizontal_menu_class)  // set horizontal class
    } else {  // vertical
        $menu.addClass(vertical_menu_class)  // set vertical class
    }

    // Get all buttons from the message menu template.
    let $buttons = $("#message_template .mes_buttons .extraMesButtons .mes_button")

    // Add those buttons from the template to the context menu
    for (let button of $buttons) {
        let icon_classes = [...button.classList].filter(cls => cls.startsWith('fa-'))  // get any FA classes (the icon)
        let tooltip = $(button).prop('title')  // the tooltip on the button

        let $menu_item;
        if (menu_mode === 'vertical') {
            let {text, title} = parse_tooltip(tooltip)
            $menu_item = $(`<div class="flex-container list-group-item ${horizontal_item_class}"><i class="${icon_classes.join(" ")}"></i><span title="${title}">${text}</span></div>`)
        } else {  // horizontal
            $menu_item = $(`<div><div class="mes_button ${icon_classes.join(" ")}" title="${tooltip}"></div></div>`)
        }

        // When this menu item is clicked, we need to simulate a click on the corresponding message button
        $menu_item.on('click', () => {
            let message_id = $menu.data('message_id')  // we stored the message ID when the menu was shown
            let message_button = $(`div[mesid="${message_id}"] .extraMesButtons .${[...button.classList].join('.')}`)
            message_button.click()
            message_button.trigger('pointerup')  // some buttons use the pointerup event instead
        })

        $menu.append($menu_item)  // add this item to the menu
    }


    // When you right-click a message, show the context menu
    $(document).on('contextmenu', 'div.mes_block div.mes_text', function(e) {
        if (get_settings('menu_mode') === 'disabled') return

        e.preventDefault();
        $menu.css({
          top: e.pageY + "px",
          left: e.pageX + "px",
        }).show();

        let message_block = e.currentTarget.parentNode
        let message = message_block.parentNode

        // When the menu is opened, we need a way to tell the items which message was clicked.
        // We can do this by storing the message id in the data attribute of the menu
        const message_id = $(message).attr("mesid");
        $menu.data("message_id", message_id)

        // Also, some items may need to be removed (some messages hide certain buttons)
        let $menu_items = $menu.find('div')
        let $message_buttons = $(message_block).find(`.extraMesButtons .mes_button`)
        for (let i=0; i<$menu_items.length; i++) {
            let $item = $($menu_items[i])
            let $button = $($message_buttons[i])  // at the same index
            if ($button.css('display') === 'none') {
                $item.hide()
            } else {
                $item.show()
            }
        }

    });

    // Clicking anywhere will make the context menu disappear
    // Hide menu on click anywhere else
    $(document).on("click", function() {
        if (get_settings('menu_mode') === 'disabled') return
        $menu.hide();
    });
}


// Entry point
jQuery(async function () {
    log(`Loading extension...`)

    // Read version from manifest.json
    const manifest = await get_manifest();
    const VERSION = manifest.version;
    log(`Version: ${VERSION}`)

    // Load settings
    initialize_settings();
    await load_settings_html();
    bind_setting('#short_term_role', 'menu_mode', 'text', init_menu);
    bind_setting('#debug_mode', 'debug_mode', 'boolean');
    bind_setting('#max_width', 'max_width_horizontal', 'number', init_menu);
    refresh_settings()

    // init
    init_menu()
});
