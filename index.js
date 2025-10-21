import {saveSettingsDebounced, setEditedMessageId} from '../../../../script.js';
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
    max_width_horizontal: 220,
    hide_message_buttons: false,
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
const hide_buttons_class = "force_hidden"
const button_name_map = {  // mapping for some default button names
    "Exclude message from prompts": "Exclude from prompts"
}

function parse_tooltip(tooltip) {
    // In vertical mode, we want to have some short text to use for the menu text.
    // For some default buttons, we have a hard-coded mapping.
    // For others, many tooltips are long so we will instead parse out any text inside parentheses, use that as a tooltip, and use any remaining text as the item text.
    if (!tooltip) return {text: "", title: ""}

    let text = tooltip
    let title = ""

    // if we have a mapping, use that
    let mapped = button_name_map[tooltip]
    if (mapped) {
        text = mapped
        title = tooltip
    } else {  // otherwise, attempt to parse out some good text
        let idx = tooltip.search(/(\s-\s)|(\(.*\)\s*)$/)
        if (idx !== -1) {
            text = tooltip.slice(0, idx).trim()
            title = tooltip.slice(idx).replace(/\s-\s|^\(|\)$/g, '')
        }
    }

    return {text: text, title: title}
}
function get_buttons($message_div) {
    // Return a jQuery selection of message buttons on the given message div.
    $message_div = $($message_div)

    let $buttons = $message_div.find(".mes_buttons .mes_button:not(.extraMesButtonsHint)")
    let array = $buttons.toArray($buttons)

    // Grab the edit button and delete button
    let $edit = $buttons.filter(".mes_edit")

    // The default behavior doesn't work when not in edit mode so we gotta trick it using setEditedMessageId
    let $delete = $message_div.find(".mes_edit_buttons .mes_edit_delete")
    let id = $message_div.attr('mesid')
    $delete.on('click', () => {
        setEditedMessageId(Number(id))
    })

    if ($edit.length > 0) {
        let at_index = array.indexOf($edit)
        array.splice(at_index, 1);
        array.splice(0, 0, $edit[0]);  // edit button goes first
        array.push($delete[0])  // delete button goes last
        $buttons = $(array)
    } else {
        debug('Failed to located edit button: ', $buttons)
    }

    return $buttons
}
function get_edit_buttons($message_div) {
        // Return a jQuery selection of message buttons on the given message div.
    $message_div = $($message_div)
    let buttons = $message_div.find(".mes_edit_buttons .menu_button").toArray()
    return $(buttons)
}
function set_menu_position(mouse_x, mouse_y) {
    // Given the mouse position, calculate the menu position (to keep it within the screen)
    let x_pos = mouse_x
    let y_pos = mouse_y
    let rect = $menu[0].getBoundingClientRect()

    // If the menu would overflow to the right, instead appear on the left
    if (x_pos + rect.width > window.screen.width) {
        x_pos = mouse_x - rect.width
    }

    // If the menu would overflow off the bottom, instead appear above
    if (y_pos + rect.height > window.screen.height) {
        y_pos = mouse_y - rect.height
    }

    $menu.css({
        left: x_pos + "px",
        top: y_pos + "px"
    })
}

function toggle_message_buttons() {
    // Show/hide all message buttons
    let hide = get_settings('hide_message_buttons')
    if (hide) {
        $('.mes_buttons, .mes_edit_buttons').addClass(hide_buttons_class)
    } else {
        $('.mes_buttons, .mes_edit_buttons').removeClass(hide_buttons_class)
    }

}
function update_menu(message_div, edit=false) {
    // Update the menu from the buttons on the given message div
    debug("Updating menu")
    $menu = $(`#${menu_id}`)
    if ($menu.length === 0) {  // not initialized yet
        $menu = $(`<div id="${menu_id}" class="options-content popup" style="position: absolute; width: unset; display: none;"></div>`)
        $('body').append($menu)
    } else {  // already initialized - clear it
        $menu.empty()
    }

    // remove horizontal/vertical class
    $menu.removeClass([vertical_menu_class, horizontal_menu_class])

    // what menu mode we are using
    let menu_mode = get_settings('menu_mode')

    if (menu_mode === 'disabled') {  // If disabled, do nothing
        return
    } else if (menu_mode === 'horizontal') {
        $menu.css('max-width', `${get_settings('max_width_horizontal')}px`)  // set max width if in horizontal mode
        $menu.addClass(horizontal_menu_class)  // set horizontal class
    } else {  // vertical
        $menu.css('max-width', 'unset')      // unset max width in vertical mode
        $menu.addClass(vertical_menu_class)  // set vertical class
    }

    // Get all buttons on the message
    let $buttons;
    if (edit) {
        $buttons = get_edit_buttons(message_div);
    } else {
        $buttons = get_buttons(message_div);
    }

    // Add those buttons to the context menu
    for (let button of $buttons) {
        let $button = $(button)

        // Don't add the button if it's hidden on the message
        if ($button.css('display') === 'none') continue

        let icon_classes = [...button.classList].filter(cls => cls.startsWith('fa-'))  // get any FA classes (the icon)
        let $icon_svg = $button.find("svg")  // icons might have been added using an svg
        let tooltip = $button.prop('title') || $button.attr('data-sttt--title')  // the tooltip on the button (with compatability for the tooltips ext)

        let $menu_item;
        if (menu_mode === 'vertical') {
            let {text, title} = parse_tooltip(tooltip)
            $menu_item = $(`<div class="flex-container list-group-item ${horizontal_item_class}"><span title="${title}">${text}</span></div>`)
        } else {  // horizontal
            $menu_item = $(`<div class="mes_button" title="${tooltip}"></div>`)
        }

        if ($icon_svg.length) {
             $menu_item.prepend($icon_svg.clone())
        } else {  // regular fa icon
             $menu_item.prepend($(`<i class="${icon_classes.join(" ")}"></i>`))
        }

        // When this menu item is clicked, simulate a click on the corresponding message button
        $menu_item.on('click', () => {
            $button.click()
            $button.trigger('pointerup')  // some buttons use the pointerup event instead
        })

        $menu.append($menu_item)  // add this item to the menu
    }
}

function handle_interaction(e) {
    if (get_settings('menu_mode') === 'disabled') return
    e.preventDefault();

    let message_block = e.currentTarget.parentNode
    let message = message_block.parentNode

    // check if the message is currently being edited
    let textbox = $(message_block).find('textarea.edit_textarea')
    update_menu(message, textbox.length > 0)
    set_menu_position(e.pageX, e.pageY)
    $menu.show();
}
function init_menu() {
    // When you right-click a message, show the context menu
    $(document).on('contextmenu', 'div.mes_block div.mes_text', function(e) {
        if (!get_settings('double_tap')) {
            handle_interaction(e)
        }
    });

    var last_tap = 0;
    $(document).on('touchend', 'div.mes_block div.mes_text', function(e) {
      let current_time = new Date().getTime();
      let tap_length = current_time - last_tap;

      if (tap_length < 300 && tap_length > 0) {
        if (get_settings('double_tap')) {
            handle_interaction(e)
        }
      }

      last_tap = current_time;
    });

    // Clicking anywhere will make the context menu disappear
    // Hide menu on click anywhere else
    $(document).on("click", function() {
        if (get_settings('menu_mode') === 'disabled') return
        if (!$menu?.is(":visible")) return
        debug("Hiding menu")
        $menu.hide()
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
    bind_setting('#menu_mode', 'menu_mode', 'text');
    bind_setting('#max_width', 'max_width_horizontal', 'number');
    bind_setting('#hide_message_buttons', 'hide_message_buttons', 'boolean', toggle_message_buttons);
    bind_setting('#double_tap', 'double_tap', 'boolean');
    bind_setting('#debug_mode', 'debug_mode', 'boolean');
    refresh_settings()

    init_menu()
    toggle_message_buttons()
});
