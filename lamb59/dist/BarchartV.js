// @svizzle/barchart v0.2.0 - © 2020 nestauk (https://www.nesta.org.uk/)
'use strict';

function noop() { }
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}

function append(target, node) {
    target.appendChild(node);
}
function insert(target, node, anchor) {
    target.insertBefore(node, anchor || null);
}
function detach(node) {
    node.parentNode.removeChild(node);
}
function element(name) {
    return document.createElement(name);
}
function svg_element(name) {
    return document.createElementNS('http://www.w3.org/2000/svg', name);
}
function text(data) {
    return document.createTextNode(data);
}
function space() {
    return text(' ');
}
function listen(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    return () => node.removeEventListener(event, handler, options);
}
function attr(node, attribute, value) {
    if (value == null)
        node.removeAttribute(attribute);
    else if (node.getAttribute(attribute) !== value)
        node.setAttribute(attribute, value);
}
function children(element) {
    return Array.from(element.childNodes);
}
function set_data(text, data) {
    data = '' + data;
    if (text.wholeText !== data)
        text.data = data;
}
// unfortunately this can't be a constant as that wouldn't be tree-shakeable
// so we cache the result instead
let crossorigin;
function is_crossorigin() {
    if (crossorigin === undefined) {
        crossorigin = false;
        try {
            if (typeof window !== 'undefined' && window.parent) {
                void window.parent.document;
            }
        }
        catch (error) {
            crossorigin = true;
        }
    }
    return crossorigin;
}
function add_resize_listener(node, fn) {
    const computed_style = getComputedStyle(node);
    const z_index = (parseInt(computed_style.zIndex) || 0) - 1;
    if (computed_style.position === 'static') {
        node.style.position = 'relative';
    }
    const iframe = element('iframe');
    iframe.setAttribute('style', `display: block; position: absolute; top: 0; left: 0; width: 100%; height: 100%; ` +
        `overflow: hidden; border: 0; opacity: 0; pointer-events: none; z-index: ${z_index};`);
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    const crossorigin = is_crossorigin();
    let unsubscribe;
    if (crossorigin) {
        iframe.src = `data:text/html,<script>onresize=function(){parent.postMessage(0,'*')}</script>`;
        unsubscribe = listen(window, 'message', (event) => {
            if (event.source === iframe.contentWindow)
                fn();
        });
    }
    else {
        iframe.src = 'about:blank';
        iframe.onload = () => {
            unsubscribe = listen(iframe.contentWindow, 'resize', fn);
        };
    }
    append(node, iframe);
    return () => {
        if (crossorigin) {
            unsubscribe();
        }
        else if (unsubscribe && iframe.contentWindow) {
            unsubscribe();
        }
        detach(iframe);
    };
}
function toggle_class(element, name, toggle) {
    element.classList[toggle ? 'add' : 'remove'](name);
}
function custom_event(type, detail) {
    const e = document.createEvent('CustomEvent');
    e.initCustomEvent(type, false, false, detail);
    return e;
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error(`Function called outside component initialization`);
    return current_component;
}
function beforeUpdate(fn) {
    get_current_component().$$.before_update.push(fn);
}
function afterUpdate(fn) {
    get_current_component().$$.after_update.push(fn);
}
function createEventDispatcher() {
    const component = get_current_component();
    return (type, detail) => {
        const callbacks = component.$$.callbacks[type];
        if (callbacks) {
            // TODO are there situations where events could be dispatched
            // in a server (non-DOM) environment?
            const event = custom_event(type, detail);
            callbacks.slice().forEach(fn => {
                fn.call(component, event);
            });
        }
    };
}

const dirty_components = [];
const binding_callbacks = [];
const render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
let flushing = false;
const seen_callbacks = new Set();
function flush() {
    if (flushing)
        return;
    flushing = true;
    do {
        // first, call beforeUpdate functions
        // and update components
        for (let i = 0; i < dirty_components.length; i += 1) {
            const component = dirty_components[i];
            set_current_component(component);
            update(component.$$);
        }
        dirty_components.length = 0;
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
                callback();
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
    flushing = false;
    seen_callbacks.clear();
}
function update($$) {
    if ($$.fragment !== null) {
        $$.update();
        run_all($$.before_update);
        const dirty = $$.dirty;
        $$.dirty = [-1];
        $$.fragment && $$.fragment.p($$.ctx, dirty);
        $$.after_update.forEach(add_render_callback);
    }
}
const outroing = new Set();
function transition_in(block, local) {
    if (block && block.i) {
        outroing.delete(block);
        block.i(local);
    }
}

function destroy_block(block, lookup) {
    block.d(1);
    lookup.delete(block.key);
}
function update_keyed_each(old_blocks, dirty, get_key, dynamic, ctx, list, lookup, node, destroy, create_each_block, next, get_context) {
    let o = old_blocks.length;
    let n = list.length;
    let i = o;
    const old_indexes = {};
    while (i--)
        old_indexes[old_blocks[i].key] = i;
    const new_blocks = [];
    const new_lookup = new Map();
    const deltas = new Map();
    i = n;
    while (i--) {
        const child_ctx = get_context(ctx, list, i);
        const key = get_key(child_ctx);
        let block = lookup.get(key);
        if (!block) {
            block = create_each_block(key, child_ctx);
            block.c();
        }
        else if (dynamic) {
            block.p(child_ctx, dirty);
        }
        new_lookup.set(key, new_blocks[i] = block);
        if (key in old_indexes)
            deltas.set(key, Math.abs(i - old_indexes[key]));
    }
    const will_move = new Set();
    const did_move = new Set();
    function insert(block) {
        transition_in(block, 1);
        block.m(node, next);
        lookup.set(block.key, block);
        next = block.first;
        n--;
    }
    while (o && n) {
        const new_block = new_blocks[n - 1];
        const old_block = old_blocks[o - 1];
        const new_key = new_block.key;
        const old_key = old_block.key;
        if (new_block === old_block) {
            // do nothing
            next = new_block.first;
            o--;
            n--;
        }
        else if (!new_lookup.has(old_key)) {
            // remove old block
            destroy(old_block, lookup);
            o--;
        }
        else if (!lookup.has(new_key) || will_move.has(new_key)) {
            insert(new_block);
        }
        else if (did_move.has(old_key)) {
            o--;
        }
        else if (deltas.get(new_key) > deltas.get(old_key)) {
            did_move.add(new_key);
            insert(new_block);
        }
        else {
            will_move.add(old_key);
            o--;
        }
    }
    while (o--) {
        const old_block = old_blocks[o];
        if (!new_lookup.has(old_block.key))
            destroy(old_block, lookup);
    }
    while (n)
        insert(new_blocks[n - 1]);
    return new_blocks;
}
function mount_component(component, target, anchor) {
    const { fragment, on_mount, on_destroy, after_update } = component.$$;
    fragment && fragment.m(target, anchor);
    // onMount happens before the initial afterUpdate
    add_render_callback(() => {
        const new_on_destroy = on_mount.map(run).filter(is_function);
        if (on_destroy) {
            on_destroy.push(...new_on_destroy);
        }
        else {
            // Edge case - component was destroyed immediately,
            // most likely as a result of a binding initialising
            run_all(new_on_destroy);
        }
        component.$$.on_mount = [];
    });
    after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
    const $$ = component.$$;
    if ($$.fragment !== null) {
        run_all($$.on_destroy);
        $$.fragment && $$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        $$.on_destroy = $$.fragment = null;
        $$.ctx = [];
    }
}
function make_dirty(component, i) {
    if (component.$$.dirty[0] === -1) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty.fill(0);
    }
    component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
}
function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
    const parent_component = current_component;
    set_current_component(component);
    const prop_values = options.props || {};
    const $$ = component.$$ = {
        fragment: null,
        ctx: null,
        // state
        props,
        update: noop,
        not_equal,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        before_update: [],
        after_update: [],
        context: new Map(parent_component ? parent_component.$$.context : []),
        // everything else
        callbacks: blank_object(),
        dirty
    };
    let ready = false;
    $$.ctx = instance
        ? instance(component, prop_values, (i, ret, ...rest) => {
            const value = rest.length ? rest[0] : ret;
            if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                if ($$.bound[i])
                    $$.bound[i](value);
                if (ready)
                    make_dirty(component, i);
            }
            return ret;
        })
        : [];
    $$.update();
    ready = true;
    run_all($$.before_update);
    // `false` as a special case of no DOM component
    $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
    if (options.target) {
        if (options.hydrate) {
            const nodes = children(options.target);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.l(nodes);
            nodes.forEach(detach);
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.c();
        }
        if (options.intro)
            transition_in(component.$$.fragment);
        mount_component(component, options.target, options.anchor);
        flush();
    }
    set_current_component(parent_component);
}
class SvelteComponent {
    $destroy() {
        destroy_component(this, 1);
        this.$destroy = noop;
    }
    $on(type, callback) {
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set() {
        // overridden by instance, if it has props
    }
}

var justCompare = compare;
function compare(value1, value2) {
  if (value1 === value2) {
    return true;
  }
  if ((value1 !== value1) && (value2 !== value2)) {
    return true;
  }
  if ({}.toString.call(value1) != {}.toString.call(value2)) {
    return false;
  }
  if (value1 !== Object(value1)) {
    return false;
  }
  if (!value1) {
    return false;
  }
  if (Array.isArray(value1)) {
    return compareArrays(value1, value2);
  }
  if ({}.toString.call(value1) == '[object Object]') {
    return compareObjects(value1, value2);
  } else {
    return compareNativeSubtypes(value1, value2);
  }
}
function compareNativeSubtypes(value1, value2) {
  return value1.toString() === value2.toString();
}
function compareArrays(value1, value2) {
  var len = value1.length;
  if (len != value2.length) {
    return false;
  }
  var alike = true;
  for (var i = 0; i < len; i++) {
    if (!compare(value1[i], value2[i])) {
      alike = false;
      break;
    }
  }
  return alike;
}
function compareObjects(value1, value2) {
  var keys1 = Object.keys(value1).sort();
  var keys2 = Object.keys(value2).sort();
  var len = keys1.length;
  if (len != keys2.length) {
    return false;
  }
  for (var i = 0; i < len; i++) {
    var key1 = keys1[i];
    var key2 = keys2[i];
    if (!(key1 == key2 && compare(value1[key1], value2[key2]))) {
      return false;
    }
  }
  return true;
}

/**
* @overview lamb - A lightweight, and docile, JavaScript library to help embracing functional programming.
* @author Andrea Scartabelli <andrea.scartabelli@gmail.com>
* @version 0.59.2
* @module lamb
* @license MIT
*/

/**
 * Verifies that the two supplied values are the same value using the "SameValueZero" comparison.<br/>
 * With this comparison <code>NaN</code> is equal to itself, but <code>0</code> and <code>-0</code> are
 * considered the same value.<br/>
 * See also {@link module:lamb.isSVZ|isSVZ} for a curried version building a predicate and
 * {@link module:lamb.areSame|areSame} and {@link module:lamb.is|is} to perform a "SameValue" comparison.
 * @example
 * const testObject = {};
 *
 * _.areSVZ({}, testObject) // => false
 * _.areSVZ(testObject, testObject) // => true
 * _.areSVZ("foo", "foo") // => true
 * _.areSVZ(0, -0) // => true
 * _.areSVZ(0 / 0, NaN) // => true
 *
 * @memberof module:lamb
 * @category Logic
 * @see {@link module:lamb.isSVZ|isSVZ}
 * @see {@link module:lamb.areSame|areSame}, {@link module:lamb.is|is}
 * @see [SameValue comparison]{@link https://www.ecma-international.org/ecma-262/7.0/#sec-samevalue}
 * @see [SameValueZero comparison]{@link https://www.ecma-international.org/ecma-262/7.0/#sec-samevaluezero}
 * @since 0.50.0
 * @param {*} a
 * @param {*} b
 * @returns {Boolean}
 */
function areSVZ (a, b) {
    return a !== a ? b !== b : a === b; // eslint-disable-line no-self-compare
}

/**
 * Builds a function that passes only two arguments to the given function.<br/>
 * It's simply a shortcut for a common use case of {@link module:lamb.aritize|aritize},
 * exposed for convenience.
 * @example
 * _.list(1, 2, 3, 4, 5) // => [1, 2, 3, 4, 5]
 * _.binary(_.list)(1, 2, 3, 4, 5) // => [1, 2]
 *
 * @memberof module:lamb
 * @category Function
 * @see {@link module:lamb.aritize|aritize}
 * @see {@link module:lamb.unary|unary}
 * @since 0.10.0
 * @param {Function} fn
 * @returns {Function}
 */
function binary (fn) {
    return function (a, b) {
        return fn.call(this, a, b);
    };
}

/**
 * "Clamps" a number within the given limits, both included.<br/>
 * The function will convert to number all its parameters before starting any
 * evaluation, and will return <code>NaN</code> if <code>min</code> is greater
 * than <code>max</code>.
 * @example
 * _.clamp(-5, 0, 10) // => 0
 * _.clamp(5, 0, 10) // => 5
 * _.clamp(15, 0, 10) // => 10
 * _.clamp(0, 0, 10) // => 0
 * _.clamp(10, 0, 10) // => 10
 * _.is(_.clamp(-0, 0, 10), -0) // => true
 * _.clamp(10, 20, 15) // => NaN
 *
 * @memberof module:lamb
 * @category Math
 * @see {@link module:lamb.clampWithin|clampWithin}
 * @since 0.13.0
 * @param {Number} n
 * @param {Number} min
 * @param {Number} max
 * @returns {Number}
 */
function clamp (n, min, max) {
    n = +n;
    min = +min;
    max = +max;

    if (min > max) {
        return NaN;
    } else {
        return n < min ? min : n > max ? max : n;
    }
}

/**
 * The I combinator. Any value passed to the function is simply returned as it is.
 * @example
 * const foo = {bar: "baz"};
 *
 * _.identity(foo) === foo // true
 *
 * @memberof module:lamb
 * @category Function
 * @see [SKI combinator calculus]{@link https://en.wikipedia.org/wiki/SKI_combinator_calculus}
 * @since 0.1.0
 * @param {*} value
 * @returns {*} The value passed as parameter.
 */
function identity (value) {
    return value;
}

var MAX_ARRAY_LENGTH = 4294967295;

/**
 * Converts a value to a valid array length, thus an integer within
 * <code>0</code> and <code>2<sup>32</sup> - 1</code> (both included).
 * @private
 * @param {*} value
 * @returns {Number}
 */
function _toArrayLength (value) {
    return clamp(value, 0, MAX_ARRAY_LENGTH) >>> 0;
}

/**
 * Creates generic functions out of methods.
 * @author A very little change on a great idea by [Irakli Gozalishvili]{@link https://github.com/Gozala/}.
 * Thanks for this *beautiful* one-liner (never liked your "unbind" naming choice, though).
 * @memberof module:lamb
 * @category Function
 * @function
 * @example
 * const join = _.generic(Array.prototype.join);
 *
 * join([1, 2, 3, 4, 5], "-") // => "1-2-3-4-5"
 *
 * // the function will work with any array-like object
 * join("hello", "-") // => "h-e-l-l-o"
 *
 * @since 0.1.0
 * @param {Function} method
 * @returns {Function}
 */
var generic = Function.bind.bind(Function.call);

/**
 * Curries a function of arity 2.
 * @private
 * @param {Function} fn
 * @param {Boolean} [isRightCurry=false]
 * @returns {Function}
 */
function _curry2 (fn, isRightCurry) {
    return function (a) {
        return function (b) {
            return isRightCurry ? fn.call(this, b, a) : fn.call(this, a, b);
        };
    };
}

/**
 * Builds a reduce function. The <code>step</code> parameter must be <code>1</code>
 * to build  {@link module:lamb.reduce|reduce} and <code>-1</code> to build
 * {@link module:lamb.reduceRight|reduceRight}.
 * @private
 * @param {Number} step
 * @returns {Function}
 */
function _makeReducer (step) {
    return function (arrayLike, accumulator, initialValue) {
        var len = _toArrayLength(arrayLike.length);
        var idx = step === 1 ? 0 : len - 1;
        var nCalls;
        var result;

        if (arguments.length === 3) {
            nCalls = len;
            result = initialValue;
        } else {
            if (len === 0) {
                throw new TypeError("Reduce of empty array-like with no initial value");
            }

            result = arrayLike[idx];
            idx += step;
            nCalls = len - 1;
        }

        for (; nCalls--; idx += step) {
            result = accumulator(result, arrayLike[idx], idx, arrayLike);
        }

        return result;
    };
}

/**
 * Reduces (or folds) the values of an array-like object, starting from the first, to a new
 * value using the provided <code>accumulator</code> function.<br/>
 * Note that unlike the native array method this function doesn't skip unassigned or deleted indexes.
 * @example
 * _.reduce([1, 2, 3, 4], _.sum) // => 10
 *
 * @memberof module:lamb
 * @category Array
 * @function
 * @see {@link module:lamb.reduceRight|reduceRight}
 * @see {@link module:lamb.reduceWith|reduceWith}, {@link module:lamb.reduceRightWith|reduceRightWith}
 * @since 0.1.0
 * @param {ArrayLike} arrayLike
 * @param {AccumulatorCallback} accumulator
 * @param {*} [initialValue]
 * @returns {*}
 */
var reduce = _makeReducer(1);

/**
 * Converts a value to an integer.
 * @private
 * @param {*} value
 * @returns {Number}
 */
function _toInteger (value) {
    var n = +value;

    if (n !== n) { // eslint-disable-line no-self-compare
        return 0;
    } else if (n % 1 === 0) {
        return n;
    } else {
        return Math.floor(Math.abs(n)) * (n < 0 ? -1 : 1);
    }
}

/**
 * Builds an array by extracting a portion of an array-like object.<br/>
 * Note that unlike the native array method this function ensures that dense
 * arrays are returned.<br/>
 * Also, unlike the native method, the <code>start</code> and <code>end</code>
 * parameters aren't optional and will be simply converted to integer.<br/>
 * See {@link module:lamb.dropFrom|dropFrom} and {@link module:lamb.drop|drop} if you want a
 * slice to the end of the array-like.
 * @example
 * const arr = [1, 2, 3, 4, 5];
 *
 * _.slice(arr, 0, 2) // => [1, 2]
 * _.slice(arr, 2, -1) // => [3, 4]
 * _.slice(arr, -3, 5) // => [3, 4, 5]
 *
 * @memberof module:lamb
 * @category Array
 * @see {@link module:lamb.sliceAt|sliceAt}
 * @see {@link module:lamb.dropFrom|dropFrom}, {@link module:lamb.drop|drop}
 * @since 0.1.0
 * @param {ArrayLike} arrayLike - Any array like object.
 * @param {Number} start - Index at which to begin extraction.
 * @param {Number} end - Index at which to end extraction. Extracts up to but not including end.
 * @returns {Array}
 */
function slice (arrayLike, start, end) {
    var len = _toArrayLength(arrayLike.length);
    var begin = _toInteger(start);
    var upTo = _toInteger(end);

    if (begin < 0) {
        begin = begin < -len ? 0 : begin + len;
    }

    if (upTo < 0) {
        upTo = upTo < -len ? 0 : upTo + len;
    } else if (upTo > len) {
        upTo = len;
    }

    var resultLen = upTo - begin;
    var result = resultLen > 0 ? Array(resultLen) : [];

    for (var i = 0; i < resultLen; i++) {
        result[i] = arrayLike[begin + i];
    }

    return result;
}

var objectProtoToString = Object.prototype.toString;

/**
 * Retrieves the "type tag" from the given value.
 * @example
 * const x = 5;
 * const y = new Number(5);
 *
 * typeof x // => "number"
 * typeof y // => "object"
 * _.type(x) // => "Number"
 * _.type(y) // => "Number"
 *
 * _.type(Object.prototype.toString) // => "Function"
 * _.type(/a/) // => "RegExp"
 *
 * @memberof module:lamb
 * @category Type
 * @see {@link module:lamb.isType|isType}
 * @since 0.9.0
 * @param {*} value
 * @returns {String}
 */
function type (value) {
    return objectProtoToString.call(value).slice(8, -1);
}

/**
 * Checks if an array-like object contains the given value.<br/>
 * Please note that the equality test is made with {@link module:lamb.areSVZ|areSVZ}; so you can
 * check for <code>NaN</code>, but <code>0</code> and <code>-0</code> are the same value.<br/>
 * See also {@link module:lamb.contains|contains} for a curried version building a predicate.
 * @example
 * const numbers = [0, 1, 2, 3, NaN];
 *
 * _.isIn(numbers, 1) // => true
 * _.isIn(numbers, 0) // => true
 * _.isIn(numbers, -0) // => true
 * _.isIn(numbers, NaN) // => true
 * _.isIn(numbers, 5) // => false
 *
 * @memberof module:lamb
 * @category Array
 * @see {@link module:lamb.contains|contains}
 * @since 0.13.0
 * @param {ArrayLike} arrayLike
 * @param {*} value
 * @returns {Boolean}
 */
function isIn (arrayLike, value) {
    var result = false;

    for (var i = 0, len = arrayLike.length; i < len; i++) {
        if (areSVZ(value, arrayLike[i])) {
            result = true;
            break;
        }
    }

    return result;
}

/**
 * Builds a "grouping function" for an array-like object.
 * @private
 * @param {Function} makeValue
 * @returns {Function}
 */
function _groupWith (makeValue) {
    return function (arrayLike, iteratee) {
        var result = {};
        var len = arrayLike.length;

        for (var i = 0, element, key; i < len; i++) {
            element = arrayLike[i];
            key = iteratee(element, i, arrayLike);
            result[key] = makeValue(result[key], element);
        }

        return result;
    };
}

/**
 * Using the provided iteratee, builds a function that will return an array comprised of the
 * unique elements of an array-like object. The values being compared are the ones returned by
 * the iteratee.<br/>
 * The equality test is made with the ["SameValueZero" comparison]{@link module:lamb.areSVZ|areSVZ}.<br/>
 * When two values are considered equal, the first occurence will be the one included
 * in the result array.<br/>
 * See also {@link module:lamb.uniques|uniques} if you don't need to transform your values before the
 * comparison.
 * @example
 * const data  = [
 *     {id: "1", name: "John"},
 *     {id: "4", name: "Jane"},
 *     {id: "5", name: "Joe"},
 *     {id: "1", name: "Mario"},
 *     {id: "5", name: "Paolo"},
 * ];
 * const uniquesById = _.uniquesBy(_.getKey("id"));
 *
 * uniquesById(data) // => [{id: "1", name: "John"}, {id: "4", name: "Jane"}, {id: "5", name: "Joe"}]
 *
 * @memberof module:lamb
 * @category Array
 * @see {@link module:lamb.uniques|uniques}
 * @since 0.51.0
 * @param {ListIteratorCallback} iteratee
 * @returns {Function}
 */
function uniquesBy (iteratee) {
    return function (arrayLike) {
        var result = [];

        for (var i = 0, len = arrayLike.length, seen = [], value; i < len; i++) {
            value = iteratee(arrayLike[i], i, arrayLike);

            if (!isIn(seen, value)) {
                seen.push(value);
                result.push(arrayLike[i]);
            }
        }

        return result;
    };
}

/**
 * Builds an array without the first <code>n</code> elements of the given array or array-like object.
 * Note that, being this only a shortcut for a specific use case of {@link module:lamb.slice|slice},
 * <code>n</code> can be a negative number.
 * @example
 * const arr = [1, 2, 3, 4, 5];
 *
 * _.dropFrom(arr, 2) // => [3, 4, 5]
 * _.dropFrom(arr, -1) // => [5]
 * _.dropFrom(arr, -10) // => [1, 2, 3, 4, 5]
 *
 * @memberof module:lamb
 * @category Array
 * @see {@link module:lamb.drop|drop}
 * @see {@link module:lamb.takeFrom|takeFrom}, {@link module:lamb.take|take}
 * @see {@link module:lamb.takeWhile|takeWhile}, {@link module:lamb.dropWhile|dropWhile}
 * @see {@link module:lamb.takeLastWhile|takeLastWhile}, {@link module:lamb.dropLastWhile|dropLastWhile}
 * @since 0.51.0
 * @param {ArrayLike} arrayLike
 * @param {Number} n
 * @returns {Array}
 */
function dropFrom (arrayLike, n) {
    return slice(arrayLike, n, arrayLike.length);
}

/**
 * A curried version of {@link module:lamb.dropFrom|dropFrom} that expects the number of elements
 * to drop to build a function waiting for the list to take the elements from.<br/>
 * See the note and examples for {@link module:lamb.dropFrom|dropFrom} about passing a
 * negative <code>n</code>.
 * @example
 * const drop2 = _.drop(2);
 *
 * drop2([1, 2, 3, 4, 5]) // => [3, 4, 5]
 *
 * @memberof module:lamb
 * @category Array
 * @function
 * @since 0.5.0
 * @see {@link module:lamb.dropFrom|dropFrom}
 * @see {@link module:lamb.takeFrom|takeFrom}, {@link module:lamb.take|take}
 * @see {@link module:lamb.takeWhile|takeWhile}, {@link module:lamb.dropWhile|dropWhile}
 * @see {@link module:lamb.takeLastWhile|takeLastWhile}, {@link module:lamb.dropLastWhile|dropLastWhile}
 * @param {Number} n
 * @returns {Function}
 */
var drop = _curry2(dropFrom, true);

/**
 * Similar to {@link module:lamb.map|map}, but if the mapping function returns an array this will
 * be concatenated, rather than pushed, to the final result.
 * @example <caption>Showing the difference with <code>map</code>:</caption>
 * const words = ["foo", "bar"];
 * const toCharArray = _.splitBy("");
 *
 * _.map(words, toCharArray) // => [["f", "o", "o"], ["b", "a", "r"]]
 * _.flatMap(words, toCharArray) // => ["f", "o", "o", "b", "a", "r"]
 *
 * @memberof module:lamb
 * @category Array
 * @see {@link module:lamb.flatMapWith|flatMapWith}
 * @see {@link module:lamb.map|map}, {@link module:lamb.mapWith|mapWith}
 * @since 0.1.0
 * @param {Array} array
 * @param {ListIteratorCallback} iteratee
 * @returns {Array}
 */
function flatMap (array, iteratee) {
    return reduce(array, function (result, el, idx, arr) {
        var v = iteratee(el, idx, arr);

        if (!Array.isArray(v)) {
            v = [v];
        }

        for (var i = 0, len = v.length, rLen = result.length; i < len; i++) {
            result[rLen + i] = v[i];
        }

        return result;
    }, []);
}

/**
 * A curried version of {@link module:lamb.flatMap|flatMap} that uses provided iteratee
 * to build a function expecting the array to act upon.
 * @example
 * const toCharArray = _.splitBy("");
 * const wordsToCharArray = _.flatMapWith(toCharArray);
 *
 * wordsToCharArray(["foo", "bar"]) // => ["f", "o", "o", "b", "a", "r"]
 *
 * @memberof module:lamb
 * @category Array
 * @function
 * @see {@link module:lamb.flatMap|flatMap}
 * @see {@link module:lamb.map|map}, {@link module:lamb.mapWith|mapWith}
 * @since 0.11.0
 * @param {ListIteratorCallback} iteratee
 * @returns {Function}
 */
var flatMapWith = _curry2(flatMap, true);

/**
 * Similar to {@link module:lamb.group|group}, but the generated lookup table will have
 * only one element of the original array-like object for each value.<br/>
 * Should be used only when you're sure that your <code>iteratee</code> won't produce
 * duplicate keys, otherwise only the last evaluated element will be in the result.
 * @example
 * const users = [
 *     {id: 1, name: "John"},
 *     {id: 2, name: "Jane"},
 *     {id: 3, name: "Mario"},
 *     {id: 4, name: "John"}
 * ];
 *
 * const indexedUsers = _.index(users, _.getKey("id"));
 *
 * // "indexedUsers" holds:
 * // {
 * //     "1": {id: 1, name: "John"},
 * //     "2": {id: 2, name: "Jane"},
 * //     "3": {id: 3, name: "Mario"},
 * //     "4": {id: 4, name: "John"}
 * // }
 *
 * @example <caption>Result of an <code>iteratee</code> producing a duplicate key:</caption>
 * const users = [
 *     {id: 1, name: "John"},
 *     {id: 2, name: "Jane"},
 *     {id: 3, name: "Mario"},
 *     {id: 4, name: "John"}
 * ];
 *
 * const indexedUsers = _.index(users, _.getKey("name"));
 *
 * // "indexedUsers" holds:
 * // {
 * //     "John": {"id": 4, "name": "John"},
 * //     "Jane": {"id": 2, "name": "Jane"},
 * //     "Mario": {"id": 3, "name": "Mario"}
 * // }
 *
 * @memberof module:lamb
 * @category Array
 * @function
 * @see {@link module:lamb.indexBy|indexBy}
 * @see {@link module:lamb.count|count}, {@link module:lamb.countBy|countBy}
 * @see {@link module:lamb.group|group}, {@link module:lamb.groupBy|groupBy}
 * @since 0.21.0
 * @param {ArrayLike} arrayLike
 * @param {ListIteratorCallback} iteratee
 * @returns {Object}
 */
var index = _groupWith(function (a, b) {
    return b;
});

/**
 * Builds helper functions to extract portions of the arguments
 * object rather efficiently without having to write for loops
 * manually for each case.<br/>
 * The arguments object needs to be passed to the apply method
 * of the generated function.
 * @private
 * @param {Number} idx
 * @returns {Function}
 */
function _argsToArrayFrom (idx) {
    return function () {
        var argsLen = arguments.length || idx;
        var len = argsLen - idx;
        var result = Array(len);

        for (var i = 0; i < len; i++) {
            result[i] = arguments[i + idx];
        }

        return result;
    };
}

/**
 * Generates an array with the values passed as arguments.<br/>
 * Behaves like ES6's [Array.of]{@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/of}.
 * @example
 * _.list(1, 2, 3) // => [1, 2, 3]
 *
 * @memberof module:lamb
 * @category Array
 * @function
 * @since 0.1.0
 * @param {...*} value
 * @returns {Array}
 */
var list = _argsToArrayFrom(0);

/**
 * Builds a TypeError stating that it's not possible to convert the given value to the
 * desired type.
 * @private
 * @param {*} value
 * @param {String} desiredType
 * @returns {TypeError}
 */
function _makeTypeErrorFor (value, desiredType) {
    return new TypeError("Cannot convert " + type(value).toLowerCase() + " to " + desiredType);
}

/**
 * Creates a pipeline of functions, where each function consumes the result of the previous one.
 * @example
 * const square = n => n ** 2;
 * const getMaxAndSquare = _.pipe([Math.max, square]);
 *
 * getMaxAndSquare(3, 5) // => 25
 *
 * @memberof module:lamb
 * @category Function
 * @function
 * @see {@link module:lamb.compose|compose}
 * @since 0.1.0
 * @param {Function[]} functions
 * @returns {Function}
 */
function pipe (functions) {
    if (!Array.isArray(functions)) {
        throw _makeTypeErrorFor(functions, "array");
    }

    var len = functions.length;

    return len ? function () {
        var result = functions[0].apply(this, arguments);

        for (var i = 1; i < len; i++) {
            result = functions[i].call(this, result);
        }

        return result;
    } : identity;
}

/**
 * Using the provided iteratee to transform values, builds a function that will
 * return an array of the unique elements  in the two provided array-like objects.<br/>
 * Uses the ["SameValueZero" comparison]{@link module:lamb.areSVZ|areSVZ}
 * to test the equality of values.<br/>
 * When two values are considered equal, the first occurence will be the one included
 * in the result array.<br/>
 * See also {@link module:lamb.union|union} if you don't need to compare transformed values.
 * @example
 * const unionByFloor = _.unionBy(Math.floor);
 *
 * unionByFloor([2.8, 3.2, 1.5], [3.5, 1.2, 4]) // => [2.8, 3.2, 1.5, 4]
 *
 * @memberof module:lamb
 * @category Array
 * @see {@link module:lamb.union|union}
 * @see {@link module:lamb.difference|difference}
 * @see {@link module:lamb.intersection|intersection}
 * @since 0.51.0
 * @param {ListIteratorCallback} iteratee
 * @returns {Function}
 */
function unionBy (iteratee) {
    return pipe([binary(list), flatMapWith(drop(0)), uniquesBy(iteratee)]);
}

/**
 * Returns a list of every unique element present in the two given array-like objects.<br/>
 * Uses the ["SameValueZero" comparison]{@link module:lamb.areSVZ|areSVZ}
 * to test the equality of values.<br/>
 * When two values are considered equal, the first occurence will be the one included
 * in the result array.<br/>
 * See also {@link module:lamb.unionBy|unionBy} if you need to transform the values before
 * the comparison or if you have to extract them from complex ones.
 * @example
 * _.union([1, 2, 3, 2], [2, 3, 4]) // => [1, 2, 3, 4]
 * _.union("abc", "bcd") // => ["a", "b", "c", "d"]
 *
 * @memberof module:lamb
 * @category Array
 * @function
 * @see {@link module:lamb.unionBy|unionBy}
 * @see {@link module:lamb.difference|difference}
 * @see {@link module:lamb.intersection|intersection}
 * @since 0.5.0
 * @param {ArrayLike} a
 * @param {ArrayLike} b
 * @returns {Array}
 */
var union = unionBy(identity);

/**
 * Checks whether the specified key is a own enumerable property of the given object or not.
 * @private
 * @function
 * @param {Object} obj
 * @param {String} key
 * @returns {Boolean}
 */
var _isOwnEnumerable = generic(Object.prototype.propertyIsEnumerable);

/**
 * Verifies if an object has the specified property and that the property isn't inherited through
 * the prototype chain.<br/>
 * @example <caption>Comparison with <code>has</code>:</caption>
 * const user = {name: "john"};
 *
 * _.has(user, "name") // => true
 * _.has(user, "surname") // => false
 * _.has(user, "toString") // => true
 *
 * _.hasOwn(user, "name") // => true
 * _.hasOwn(user, "surname") // => false
 * _.hasOwn(user, "toString") // => false
 *
 * @memberof module:lamb
 * @category Object
 * @function
 * @see {@link module:lamb.hasOwnKey|hasOwnKey}
 * @see {@link module:lamb.has|has}, {@link module:lamb.hasKey|hasKey}
 * @see {@link module:lamb.pathExistsIn|pathExistsIn}, {@link module:lamb.pathExists|pathExists}
 * @since 0.1.0
 * @param {Object} obj
 * @param {String} key
 * @returns {Boolean}
 */
var hasOwn = generic(Object.prototype.hasOwnProperty);

/**
 * Splits a string into an array of substrings using the given separator.
 * @example
 * _.split("Jan,Feb,Mar,Apr,May", ",") // => ["Jan", "Feb", "Mar", "Apr", "May"]
 * _.split("Jan, Feb , Mar,Apr,   May", /\s*,\s*‍/) // => ["Jan", "Feb", "Mar", "Apr", "May"]
 *
 * @memberof module:lamb
 * @category String
 * @function
 * @see {@link module:lamb.splitBy|splitBy}
 * @see {@link module:lamb.join|join}, {@link module:lamb.joinWith|joinWith}
 * @since 0.59.0
 * @param {String} source
 * @param {String|RegExp} separator
 * @returns {String[]}
 */
var split = binary(generic(String.prototype.split));

/**
 * A generic version of <code>String.prototype.search</code>
 * @private
 * @function
 * @param {String} s
 * @param {RegExp} pattern
 * @returns {Number}
 */
var _search = generic(String.prototype.search);

function linear(domain, range) {
    var d0 = domain[0];
    var r0 = range[0];
    var m = (range[1] - r0) / (domain[1] - d0);
    return Object.assign(function (num) {
        return r0 + (num - d0) * m;
    }, {
        inverse: function () { return linear(range, domain); }
    });
}

/* src/BarchartVDiv.svelte generated by Svelte v3.24.0 */

function add_css() {
	var style = element("style");
	style.id = "svelte-79144u-style";
	style.textContent = ".BarchartVDiv.svelte-79144u.svelte-79144u{width:100%;height:100%;padding:var(--padding)}header.svelte-79144u.svelte-79144u{width:100%;height:var(--headerHeight);display:flex;align-items:center}h2.svelte-79144u.svelte-79144u{margin:0}main.svelte-79144u.svelte-79144u{width:100%;height:100%;max-height:100%;overflow-y:auto}main.titled.svelte-79144u.svelte-79144u{height:calc(100% - var(--headerHeight));max-height:calc(100% - var(--headerHeight))}rect.bkg.svelte-79144u.svelte-79144u{fill-opacity:var(--backgroundOpacity);fill:var(--backgroundColor)}.item.clickable.svelte-79144u.svelte-79144u{cursor:pointer}.item.svelte-79144u text.svelte-79144u{fill:var(--textColor);font-size:var(--fontSize);stroke:none}.item.svelte-79144u text.key.neg.svelte-79144u{text-anchor:end}.item.svelte-79144u text.value.svelte-79144u{text-anchor:end}.item.svelte-79144u text.value.neg.svelte-79144u{text-anchor:start}";
	append(document.head, style);
}

function get_each_context(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[50] = list[i].barColor;
	child_ctx[51] = list[i].bkgColor;
	child_ctx[52] = list[i].displayValue;
	child_ctx[53] = list[i].dxKey;
	child_ctx[54] = list[i].isNeg;
	child_ctx[55] = list[i].key;
	child_ctx[56] = list[i].label;
	child_ctx[57] = list[i].x;
	child_ctx[58] = list[i].xValue;
	child_ctx[60] = i;
	return child_ctx;
}

// (184:1) {#if title}
function create_if_block_1(ctx) {
	let header;
	let h2;
	let t;

	return {
		c() {
			header = element("header");
			h2 = element("h2");
			t = text(/*title*/ ctx[3]);
			attr(h2, "class", "svelte-79144u");
			attr(header, "class", "svelte-79144u");
		},
		m(target, anchor) {
			insert(target, header, anchor);
			append(header, h2);
			append(h2, t);
		},
		p(ctx, dirty) {
			if (dirty[0] & /*title*/ 8) set_data(t, /*title*/ ctx[3]);
		},
		d(detaching) {
			if (detaching) detach(header);
		}
	};
}

// (199:4) {#each bars as {      barColor,      bkgColor,      displayValue,      dxKey,      isNeg,      key,      label,      x,      xValue,     }
function create_each_block(key_1, ctx) {
	let g;
	let rect;
	let rect_fill_value;
	let line;
	let line_stroke_value;
	let line_x__value;
	let text0;
	let t0_value = /*label*/ ctx[56] + "";
	let t0;
	let text0_dx_value;
	let text1;
	let t1_value = /*displayValue*/ ctx[52] + "";
	let t1;
	let text1_x_value;
	let g_transform_value;
	let mounted;
	let dispose;

	return {
		key: key_1,
		first: null,
		c() {
			g = svg_element("g");
			rect = svg_element("rect");
			line = svg_element("line");
			text0 = svg_element("text");
			t0 = text(t0_value);
			text1 = svg_element("text");
			t1 = text(t1_value);
			attr(rect, "width", /*width*/ ctx[6]);
			attr(rect, "fill", rect_fill_value = /*bkgColor*/ ctx[51]);
			attr(rect, "height", /*itemHeight*/ ctx[9]);
			attr(line, "stroke", line_stroke_value = /*barColor*/ ctx[50]);
			attr(line, "stroke-width", /*barHeight*/ ctx[0]);
			attr(line, "x1", /*x0*/ ctx[14]);
			attr(line, "x2", line_x__value = /*x*/ ctx[57]);
			attr(line, "y1", /*barY*/ ctx[10]);
			attr(line, "y2", /*barY*/ ctx[10]);
			attr(text0, "class", "key svelte-79144u");
			attr(text0, "dx", text0_dx_value = /*dxKey*/ ctx[53]);
			attr(text0, "x", /*x0*/ ctx[14]);
			attr(text0, "y", /*textY*/ ctx[11]);
			toggle_class(text0, "neg", /*isNeg*/ ctx[54]);
			attr(text1, "class", "value svelte-79144u");
			attr(text1, "x", text1_x_value = /*xValue*/ ctx[58]);
			attr(text1, "y", /*textY*/ ctx[11]);
			toggle_class(text1, "neg", /*isNeg*/ ctx[54]);
			attr(g, "class", "item svelte-79144u");
			attr(g, "transform", g_transform_value = "translate(0, " + /*itemHeight*/ ctx[9] * /*index*/ ctx[60] + ")");
			toggle_class(g, "clickable", /*isInteractive*/ ctx[1]);
			this.first = g;
		},
		m(target, anchor) {
			insert(target, g, anchor);
			append(g, rect);
			append(g, line);
			append(g, text0);
			append(text0, t0);
			append(g, text1);
			append(text1, t1);

			if (!mounted) {
				dispose = [
					listen(g, "click", function () {
						if (is_function(/*onClick*/ ctx[16](/*key*/ ctx[55]))) /*onClick*/ ctx[16](/*key*/ ctx[55]).apply(this, arguments);
					}),
					listen(g, "mouseenter", function () {
						if (is_function(/*onMouseenter*/ ctx[17](/*key*/ ctx[55]))) /*onMouseenter*/ ctx[17](/*key*/ ctx[55]).apply(this, arguments);
					}),
					listen(g, "mouseleave", function () {
						if (is_function(/*onMouseleave*/ ctx[18](/*key*/ ctx[55]))) /*onMouseleave*/ ctx[18](/*key*/ ctx[55]).apply(this, arguments);
					})
				];

				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;

			if (dirty[0] & /*width*/ 64) {
				attr(rect, "width", /*width*/ ctx[6]);
			}

			if (dirty[0] & /*bars*/ 32768 && rect_fill_value !== (rect_fill_value = /*bkgColor*/ ctx[51])) {
				attr(rect, "fill", rect_fill_value);
			}

			if (dirty[0] & /*itemHeight*/ 512) {
				attr(rect, "height", /*itemHeight*/ ctx[9]);
			}

			if (dirty[0] & /*bars*/ 32768 && line_stroke_value !== (line_stroke_value = /*barColor*/ ctx[50])) {
				attr(line, "stroke", line_stroke_value);
			}

			if (dirty[0] & /*barHeight*/ 1) {
				attr(line, "stroke-width", /*barHeight*/ ctx[0]);
			}

			if (dirty[0] & /*x0*/ 16384) {
				attr(line, "x1", /*x0*/ ctx[14]);
			}

			if (dirty[0] & /*bars*/ 32768 && line_x__value !== (line_x__value = /*x*/ ctx[57])) {
				attr(line, "x2", line_x__value);
			}

			if (dirty[0] & /*barY*/ 1024) {
				attr(line, "y1", /*barY*/ ctx[10]);
			}

			if (dirty[0] & /*barY*/ 1024) {
				attr(line, "y2", /*barY*/ ctx[10]);
			}

			if (dirty[0] & /*bars*/ 32768 && t0_value !== (t0_value = /*label*/ ctx[56] + "")) set_data(t0, t0_value);

			if (dirty[0] & /*bars*/ 32768 && text0_dx_value !== (text0_dx_value = /*dxKey*/ ctx[53])) {
				attr(text0, "dx", text0_dx_value);
			}

			if (dirty[0] & /*x0*/ 16384) {
				attr(text0, "x", /*x0*/ ctx[14]);
			}

			if (dirty[0] & /*textY*/ 2048) {
				attr(text0, "y", /*textY*/ ctx[11]);
			}

			if (dirty[0] & /*bars*/ 32768) {
				toggle_class(text0, "neg", /*isNeg*/ ctx[54]);
			}

			if (dirty[0] & /*bars*/ 32768 && t1_value !== (t1_value = /*displayValue*/ ctx[52] + "")) set_data(t1, t1_value);

			if (dirty[0] & /*bars*/ 32768 && text1_x_value !== (text1_x_value = /*xValue*/ ctx[58])) {
				attr(text1, "x", text1_x_value);
			}

			if (dirty[0] & /*textY*/ 2048) {
				attr(text1, "y", /*textY*/ ctx[11]);
			}

			if (dirty[0] & /*bars*/ 32768) {
				toggle_class(text1, "neg", /*isNeg*/ ctx[54]);
			}

			if (dirty[0] & /*itemHeight, bars*/ 33280 && g_transform_value !== (g_transform_value = "translate(0, " + /*itemHeight*/ ctx[9] * /*index*/ ctx[60] + ")")) {
				attr(g, "transform", g_transform_value);
			}

			if (dirty[0] & /*isInteractive*/ 2) {
				toggle_class(g, "clickable", /*isInteractive*/ ctx[1]);
			}
		},
		d(detaching) {
			if (detaching) detach(g);
			mounted = false;
			run_all(dispose);
		}
	};
}

// (247:3) {#if crossesZero}
function create_if_block(ctx) {
	let line;
	let line_stroke_value;

	return {
		c() {
			line = svg_element("line");
			attr(line, "stroke", line_stroke_value = /*theme*/ ctx[2].axisColor);
			attr(line, "x1", /*x0*/ ctx[14]);
			attr(line, "x2", /*x0*/ ctx[14]);
			attr(line, "y2", /*svgHeight*/ ctx[12]);
		},
		m(target, anchor) {
			insert(target, line, anchor);
		},
		p(ctx, dirty) {
			if (dirty[0] & /*theme*/ 4 && line_stroke_value !== (line_stroke_value = /*theme*/ ctx[2].axisColor)) {
				attr(line, "stroke", line_stroke_value);
			}

			if (dirty[0] & /*x0*/ 16384) {
				attr(line, "x1", /*x0*/ ctx[14]);
			}

			if (dirty[0] & /*x0*/ 16384) {
				attr(line, "x2", /*x0*/ ctx[14]);
			}

			if (dirty[0] & /*svgHeight*/ 4096) {
				attr(line, "y2", /*svgHeight*/ ctx[12]);
			}
		},
		d(detaching) {
			if (detaching) detach(line);
		}
	};
}

function create_fragment(ctx) {
	let div;
	let t;
	let main;
	let svg;
	let rect;
	let g;
	let each_blocks = [];
	let each_1_lookup = new Map();
	let main_resize_listener;
	let mounted;
	let dispose;
	let if_block0 = /*title*/ ctx[3] && create_if_block_1(ctx);
	let each_value = /*bars*/ ctx[15];
	const get_key = ctx => /*key*/ ctx[55];

	for (let i = 0; i < each_value.length; i += 1) {
		let child_ctx = get_each_context(ctx, each_value, i);
		let key = get_key(child_ctx);
		each_1_lookup.set(key, each_blocks[i] = create_each_block(key, child_ctx));
	}

	let if_block1 = /*crossesZero*/ ctx[13] && create_if_block(ctx);

	return {
		c() {
			div = element("div");
			if (if_block0) if_block0.c();
			t = space();
			main = element("main");
			svg = svg_element("svg");
			rect = svg_element("rect");
			g = svg_element("g");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			if (if_block1) if_block1.c();
			attr(rect, "class", "bkg svelte-79144u");
			attr(rect, "width", /*width*/ ctx[6]);
			attr(rect, "height", /*svgHeight*/ ctx[12]);
			attr(svg, "width", /*width*/ ctx[6]);
			attr(svg, "height", /*svgHeight*/ ctx[12]);
			attr(main, "class", "svelte-79144u");
			add_render_callback(() => /*main_elementresize_handler*/ ctx[29].call(main));
			toggle_class(main, "titled", /*title*/ ctx[3]);
			attr(div, "style", /*style*/ ctx[8]);
			attr(div, "class", "BarchartVDiv svelte-79144u");
		},
		m(target, anchor) {
			insert(target, div, anchor);
			if (if_block0) if_block0.m(div, null);
			append(div, t);
			append(div, main);
			append(main, svg);
			append(svg, rect);
			append(svg, g);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(g, null);
			}

			if (if_block1) if_block1.m(svg, null);
			main_resize_listener = add_resize_listener(main, /*main_elementresize_handler*/ ctx[29].bind(main));
			/*main_binding*/ ctx[30](main);

			if (!mounted) {
				dispose = listen(main, "mouseleave", /*mouseleave_handler*/ ctx[31]);
				mounted = true;
			}
		},
		p(ctx, dirty) {
			if (/*title*/ ctx[3]) {
				if (if_block0) {
					if_block0.p(ctx, dirty);
				} else {
					if_block0 = create_if_block_1(ctx);
					if_block0.c();
					if_block0.m(div, t);
				}
			} else if (if_block0) {
				if_block0.d(1);
				if_block0 = null;
			}

			if (dirty[0] & /*width*/ 64) {
				attr(rect, "width", /*width*/ ctx[6]);
			}

			if (dirty[0] & /*svgHeight*/ 4096) {
				attr(rect, "height", /*svgHeight*/ ctx[12]);
			}

			if (dirty[0] & /*itemHeight, bars, isInteractive, onClick, onMouseenter, onMouseleave, textY, x0, barHeight, barY, width*/ 511555) {
				const each_value = /*bars*/ ctx[15];
				each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx, each_value, each_1_lookup, g, destroy_block, create_each_block, null, get_each_context);
			}

			if (/*crossesZero*/ ctx[13]) {
				if (if_block1) {
					if_block1.p(ctx, dirty);
				} else {
					if_block1 = create_if_block(ctx);
					if_block1.c();
					if_block1.m(svg, null);
				}
			} else if (if_block1) {
				if_block1.d(1);
				if_block1 = null;
			}

			if (dirty[0] & /*width*/ 64) {
				attr(svg, "width", /*width*/ ctx[6]);
			}

			if (dirty[0] & /*svgHeight*/ 4096) {
				attr(svg, "height", /*svgHeight*/ ctx[12]);
			}

			if (dirty[0] & /*title*/ 8) {
				toggle_class(main, "titled", /*title*/ ctx[3]);
			}

			if (dirty[0] & /*style*/ 256) {
				attr(div, "style", /*style*/ ctx[8]);
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(div);
			if (if_block0) if_block0.d();

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].d();
			}

			if (if_block1) if_block1.d();
			main_resize_listener();
			/*main_binding*/ ctx[30](null);
			mounted = false;
			dispose();
		}
	};
}

const transparentColor = "rgba(0,0,0,0)";

function instance($$self, $$props, $$invalidate) {
	const arrayMaxWith = fn => _.reduceWith(
		(max, item) => {
			const value = fn(item);
			return value > max ? value : max;
		},
		-Infinity
	);

	const arrayMinWith = fn => _.reduceWith(
		(min, item) => {
			const value = fn(item);
			return value < min ? value : min;
		},
		Infinity
	);

	const getKey = _.getKey("key");
	const getValue = _.getKey("value");

	const makeStyleVars = _.pipe([
		_.skipIf(_.isNil),
		_.pairs,
		_.mapWith(_.pipe([joinWithColon, prepend("--")])),
		joinWithSemicolon
	]);

	const dispatch = createEventDispatcher();

	const defaultTheme = {
		// exposed but undocumented
		backgroundOpacity: 1,
		// exposed and documented
		axisColor: "grey",
		backgroundColor: transparentColor,
		barDefaultColor: "black",
		focusedKeyColor: "rgba(0, 0, 0, 0.1)",
		fontSize: 14,
		headerHeight: "2rem",
		hoverColor: "rgba(0, 0, 0, 0.05)",
		padding: "10px",
		textColor: "grey"
	};

	let { barHeight } = $$props;
	let { focusedKey } = $$props;
	let { formatFn } = $$props;
	let { isInteractive } = $$props;
	let { items } = $$props;
	let { keyToColor } = $$props;
	let { keyToColorFn } = $$props;
	let { keyToLabel } = $$props;
	let { keyToLabelFn } = $$props;
	let { shouldResetScroll } = $$props;
	let { shouldScrollToFocusedKey } = $$props;
	let { theme } = $$props;
	let { title } = $$props;
	let { valueAccessor } = $$props;
	let height;
	let hoveredKey;
	let width;

	/* scroll */
	let previousItems;

	let scrollable;
	let wasNotResettingScroll;

	beforeUpdate(() => {
		$$invalidate(33, wasNotResettingScroll = !shouldResetScroll);
	});

	/* events */
	const onClick = key => () => {
		isInteractive && dispatch("clicked", { id: key });
	};

	const onMouseenter = key => () => {
		isInteractive && dispatch("entered", { id: key });
		$$invalidate(5, hoveredKey = key);
	};

	const onMouseleave = key => () => {
		isInteractive && dispatch("exited", { id: key });
	};

	function main_elementresize_handler() {
		width = this.clientWidth;
		height = this.clientHeight;
		$$invalidate(6, width);
		$$invalidate(4, height);
	}

	function main_binding($$value) {
		binding_callbacks[$$value ? "unshift" : "push"](() => {
			scrollable = $$value;
			(((($$invalidate(7, scrollable), $$invalidate(23, items)), $$invalidate(19, shouldResetScroll)), $$invalidate(32, previousItems)), $$invalidate(33, wasNotResettingScroll));
		});
	}

	const mouseleave_handler = () => {
		$$invalidate(5, hoveredKey = null);
	};

	$$self.$set = $$props => {
		if ("barHeight" in $$props) $$invalidate(0, barHeight = $$props.barHeight);
		if ("focusedKey" in $$props) $$invalidate(21, focusedKey = $$props.focusedKey);
		if ("formatFn" in $$props) $$invalidate(22, formatFn = $$props.formatFn);
		if ("isInteractive" in $$props) $$invalidate(1, isInteractive = $$props.isInteractive);
		if ("items" in $$props) $$invalidate(23, items = $$props.items);
		if ("keyToColor" in $$props) $$invalidate(24, keyToColor = $$props.keyToColor);
		if ("keyToColorFn" in $$props) $$invalidate(25, keyToColorFn = $$props.keyToColorFn);
		if ("keyToLabel" in $$props) $$invalidate(26, keyToLabel = $$props.keyToLabel);
		if ("keyToLabelFn" in $$props) $$invalidate(27, keyToLabelFn = $$props.keyToLabelFn);
		if ("shouldResetScroll" in $$props) $$invalidate(19, shouldResetScroll = $$props.shouldResetScroll);
		if ("shouldScrollToFocusedKey" in $$props) $$invalidate(28, shouldScrollToFocusedKey = $$props.shouldScrollToFocusedKey);
		if ("theme" in $$props) $$invalidate(2, theme = $$props.theme);
		if ("title" in $$props) $$invalidate(3, title = $$props.title);
		if ("valueAccessor" in $$props) $$invalidate(20, valueAccessor = $$props.valueAccessor);
	};

	let style;
	let barPadding;
	let itemHeight;
	let barY;
	let textY;
	let svgHeight;
	let getMin;
	let getMax;
	let min;
	let max;
	let crossesZero;
	let domain;
	let getX;
	let x0;
	let bars;
	let barsByKey;
	let focusedY;

	$$self.$$.update = () => {
		if ($$self.$$.dirty[0] & /*barHeight*/ 1) {
			// FIXME https://github.com/sveltejs/svelte/issues/4442
			 $$invalidate(0, barHeight = barHeight || 4);
		}

		if ($$self.$$.dirty[0] & /*isInteractive*/ 2) {
			 $$invalidate(1, isInteractive = isInteractive || false);
		}

		if ($$self.$$.dirty[0] & /*shouldResetScroll*/ 524288) {
			 $$invalidate(19, shouldResetScroll = shouldResetScroll || false);
		}

		if ($$self.$$.dirty[0] & /*theme*/ 4) {
			 $$invalidate(2, theme = theme ? { ...defaultTheme, ...theme } : defaultTheme);
		}

		if ($$self.$$.dirty[0] & /*valueAccessor*/ 1048576) {
			 $$invalidate(20, valueAccessor = valueAccessor || getValue);
		}

		if ($$self.$$.dirty[0] & /*theme*/ 4) {
			 $$invalidate(8, style = makeStyleVars(theme));
		}

		if ($$self.$$.dirty[0] & /*theme*/ 4) {
			 $$invalidate(34, barPadding = theme.fontSize / 2);
		}

		if ($$self.$$.dirty[0] & /*theme, barHeight*/ 5 | $$self.$$.dirty[1] & /*barPadding*/ 8) {
			 $$invalidate(9, itemHeight = theme.fontSize + barHeight + 3 * barPadding);
		}

		if ($$self.$$.dirty[0] & /*itemHeight, barHeight*/ 513 | $$self.$$.dirty[1] & /*barPadding*/ 8) {
			 $$invalidate(10, barY = itemHeight - barPadding - barHeight / 2);
		}

		if ($$self.$$.dirty[0] & /*itemHeight, barHeight*/ 513 | $$self.$$.dirty[1] & /*barPadding*/ 8) {
			 $$invalidate(11, textY = itemHeight - barHeight - 2 * barPadding);
		}

		if ($$self.$$.dirty[0] & /*itemHeight, items*/ 8389120) {
			 $$invalidate(12, svgHeight = itemHeight * items.length);
		}

		if ($$self.$$.dirty[0] & /*valueAccessor*/ 1048576) {
			 $$invalidate(35, getMin = arrayMinWith(valueAccessor));
		}

		if ($$self.$$.dirty[0] & /*valueAccessor*/ 1048576) {
			 $$invalidate(36, getMax = arrayMaxWith(valueAccessor));
		}

		if ($$self.$$.dirty[0] & /*items*/ 8388608 | $$self.$$.dirty[1] & /*getMin*/ 16) {
			 $$invalidate(37, min = getMin(items));
		}

		if ($$self.$$.dirty[0] & /*items*/ 8388608 | $$self.$$.dirty[1] & /*getMax*/ 32) {
			 $$invalidate(38, max = getMax(items));
		}

		if ($$self.$$.dirty[1] & /*min, max*/ 192) {
			 $$invalidate(13, crossesZero = Math.sign(min) !== Math.sign(max));
		}

		if ($$self.$$.dirty[0] & /*crossesZero*/ 8192 | $$self.$$.dirty[1] & /*min, max*/ 192) {
			 $$invalidate(39, domain = crossesZero ? [min, max] : max > 0 ? [0, max] : [min, 0]);
		}

		if ($$self.$$.dirty[0] & /*width*/ 64 | $$self.$$.dirty[1] & /*domain*/ 256) {
			 $$invalidate(40, getX = linear(domain, [0, width]));
		}

		if ($$self.$$.dirty[1] & /*getX*/ 512) {
			 $$invalidate(14, x0 = getX(0));
		}

		if ($$self.$$.dirty[0] & /*items, valueAccessor, keyToColor, theme, keyToColorFn, focusedKey, hoveredKey, formatFn, crossesZero, keyToLabel, keyToLabelFn, width, itemHeight*/ 267395684 | $$self.$$.dirty[1] & /*barPadding, getX*/ 520) {
			 $$invalidate(15, bars = items.map((item, idx) => {
				const value = valueAccessor(item);
				const isNeg = value < 0;

				return {
					...item,
					...{
						barColor: keyToColor
						? keyToColor[item.key] || theme.barDefaultColor
						: keyToColorFn
							? keyToColorFn(item.key)
							: theme.barDefaultColor,
						bkgColor: item.key === focusedKey
						? theme.focusedKeyColor
						: item.key === hoveredKey
							? theme.hoverColor
							: transparentColor,
						displayValue: formatFn ? formatFn(value) : value,
						dxKey: crossesZero ? isNeg ? -barPadding : barPadding : 0,
						isNeg,
						label: keyToLabel && keyToLabel[item.key]
						? keyToLabel[item.key]
						: keyToLabelFn ? keyToLabelFn(item.key) : item.key,
						x: getX(value),
						xValue: value > 0 ? width : 0,
						y: (idx + 1) * itemHeight, // bottom of the item rect
						
					}
				};
			}));
		}

		if ($$self.$$.dirty[0] & /*bars*/ 32768) {
			 $$invalidate(41, barsByKey = index(bars, getKey));
		}

		if ($$self.$$.dirty[0] & /*items, shouldResetScroll*/ 8912896 | $$self.$$.dirty[1] & /*previousItems*/ 2) {
			 afterUpdate(() => {
				if (items && shouldResetScroll && !justCompare(previousItems, items)) {
					$$invalidate(7, scrollable.scrollTop = 0, scrollable);
					$$invalidate(32, previousItems = items);
				}
			});
		}

		if ($$self.$$.dirty[0] & /*shouldResetScroll, scrollable*/ 524416 | $$self.$$.dirty[1] & /*wasNotResettingScroll*/ 4) {
			 if (wasNotResettingScroll && shouldResetScroll && scrollable) {
				$$invalidate(7, scrollable.scrollTop = 0, scrollable);
			}
		}

		if ($$self.$$.dirty[0] & /*shouldScrollToFocusedKey, focusedKey*/ 270532608 | $$self.$$.dirty[1] & /*barsByKey*/ 1024) {
			 $$invalidate(42, focusedY = shouldScrollToFocusedKey && focusedKey && barsByKey[focusedKey] && barsByKey[focusedKey].y);
		}

		if ($$self.$$.dirty[0] & /*shouldScrollToFocusedKey, focusedKey, scrollable, itemHeight, height*/ 270533264 | $$self.$$.dirty[1] & /*focusedY*/ 2048) {
			 if (shouldScrollToFocusedKey && focusedKey && scrollable) {
				const yAbs = -scrollable.scrollTop + focusedY;

				if (yAbs < 0) {
					scrollable.scroll({
						top: focusedY - itemHeight,
						behavior: "smooth"
					});
				} else if (yAbs > height) {
					scrollable.scroll({
						top: focusedY - height,
						behavior: "smooth"
					});
				}
			}
		}
	};

	return [
		barHeight,
		isInteractive,
		theme,
		title,
		height,
		hoveredKey,
		width,
		scrollable,
		style,
		itemHeight,
		barY,
		textY,
		svgHeight,
		crossesZero,
		x0,
		bars,
		onClick,
		onMouseenter,
		onMouseleave,
		shouldResetScroll,
		valueAccessor,
		focusedKey,
		formatFn,
		items,
		keyToColor,
		keyToColorFn,
		keyToLabel,
		keyToLabelFn,
		shouldScrollToFocusedKey,
		main_elementresize_handler,
		main_binding,
		mouseleave_handler
	];
}

class BarchartVDiv extends SvelteComponent {
	constructor(options) {
		super();
		if (!document.getElementById("svelte-79144u-style")) add_css();

		init(
			this,
			options,
			instance,
			create_fragment,
			safe_not_equal,
			{
				barHeight: 0,
				focusedKey: 21,
				formatFn: 22,
				isInteractive: 1,
				items: 23,
				keyToColor: 24,
				keyToColorFn: 25,
				keyToLabel: 26,
				keyToLabelFn: 27,
				shouldResetScroll: 19,
				shouldScrollToFocusedKey: 28,
				theme: 2,
				title: 3,
				valueAccessor: 20
			},
			[-1, -1]
		);
	}
}

module.exports = BarchartVDiv;
