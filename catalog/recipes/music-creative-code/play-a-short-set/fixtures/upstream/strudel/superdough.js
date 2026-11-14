/*
* superdough 1.3.0, Strudel's Web Audio synth, and its dependencies.
* Built for the Tasting Kitchen music room from the npm packages pinned in manifest.json, unminified.
* Licence: AGPL-3.0-or-later (see LICENSE). Other notices: THIRD-PARTY-NOTICES.md.
* Upstream source: https://codeberg.org/uzu/strudel
* Modified: 2026-11-13: superdough loads its AudioWorklet processors from worklets.js beside the page instead of an inlined data: URL.
* Modified: 2026-11-13: the shared-worker scheduler (NeoCyclist) of @strudel/core is replaced by a stub; the room never schedules in real time.
*/
var RoomAudio = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region node_modules/superdough/feedbackdelay.mjs
	if (typeof DelayNode !== "undefined") {
		class FeedbackDelayNode extends DelayNode {
			constructor(ac, wet, time, feedback) {
				super(ac);
				wet = Math.abs(wet);
				this.delayTime.value = time;
				this.feedbackGain = ac.createGain();
				this.feedbackGain.gain.value = Math.min(Math.abs(feedback), .995);
				this.feedback = this.feedbackGain.gain;
				this.delayGain = ac.createGain();
				this.delayGain.gain.value = wet;
				this.connect(this.feedbackGain);
				this.connect(this.delayGain);
				this.feedbackGain.connect(this);
				this.connect = (target) => this.delayGain.connect(target);
				return this;
			}
			start(t) {
				this.delayGain.gain.setValueAtTime(this.delayGain.gain.value, t + this.delayTime.value);
			}
		}
		BaseAudioContext.prototype.createFeedbackDelay = function(wet, time, feedback) {
			return new FeedbackDelayNode(this, wet, time, feedback);
		};
	}
	//#endregion
	//#region node_modules/superdough/audioContext.mjs
	var audioContext;
	var setDefaultAudioContext = () => {
		audioContext = new AudioContext();
		return audioContext;
	};
	var getAudioContext = () => {
		if (!audioContext) return setDefaultAudioContext();
		return audioContext;
	};
	//#endregion
	//#region node_modules/superdough/logger.mjs
	var log = (msg) => console.log(msg);
	function errorLogger(e, origin = "superdough") {
		logger(`[${origin}] error: ${e.message}`);
	}
	var logger = (...args) => log(...args);
	//#endregion
	//#region node_modules/superdough/noise.mjs
	var noiseCache = {};
	function getNoiseBuffer(type, density) {
		const ac = getAudioContext();
		if (noiseCache[type]) return noiseCache[type];
		const bufferSize = 2 * ac.sampleRate;
		const noiseBuffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
		const output = noiseBuffer.getChannelData(0);
		let lastOut = 0;
		let b0, b1, b2, b3, b4, b5, b6;
		b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0;
		for (let i = 0; i < bufferSize; i++) if (type === "white") output[i] = Math.random() * 2 - 1;
		else if (type === "brown") {
			let white = Math.random() * 2 - 1;
			output[i] = (lastOut + .02 * white) / 1.02;
			lastOut = output[i];
		} else if (type === "pink") {
			let white = Math.random() * 2 - 1;
			b0 = .99886 * b0 + white * .0555179;
			b1 = .99332 * b1 + white * .0750759;
			b2 = .969 * b2 + white * .153852;
			b3 = .8665 * b3 + white * .3104856;
			b4 = .55 * b4 + white * .5329522;
			b5 = -.7616 * b5 - white * .016898;
			output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * .5362;
			output[i] *= .11;
			b6 = white * .115926;
		} else if (type === "crackle") {
			const probability = density * .01;
			if (Math.random() < probability) output[i] = Math.random() * 2 - 1;
			else output[i] = 0;
		}
		if (type !== "crackle") noiseCache[type] = noiseBuffer;
		return noiseBuffer;
	}
	function getNoiseOscillator(type = "white", t, density = .02) {
		const o = getAudioContext().createBufferSource();
		o.buffer = getNoiseBuffer(type, density);
		o.loop = true;
		o.start(t);
		return {
			node: o,
			stop: (time) => o.stop(time)
		};
	}
	function getNoiseMix(inputNode, wet, t) {
		const noiseOscillator = getNoiseOscillator("pink", t);
		const noiseMix = drywet(inputNode, noiseOscillator.node, wet);
		onceEnded(noiseOscillator.node, () => {
			releaseAudioNode(noiseOscillator.node);
		});
		return {
			node: noiseMix.node,
			stop: (time) => noiseOscillator?.stop(time),
			teardown: noiseMix.teardown
		};
	}
	//#endregion
	//#region node_modules/superdough/nodePools.mjs
	var nodePools = /* @__PURE__ */ new Map();
	var POOL_KEY = Symbol("nodePoolKey");
	var isPoolable = (node) => !!node[POOL_KEY];
	var getNodeTime = (node) => {
		return node.context?.currentTime ?? 0;
	};
	var getParams = (node) => {
		const params = /* @__PURE__ */ new Set();
		node.parameters?.forEach((param) => params.add(param));
		const visited = /* @__PURE__ */ new Set();
		let proto = node;
		while (proto !== Object.prototype) {
			for (const key of Object.getOwnPropertyNames(proto)) {
				if (visited.has(key)) continue;
				visited.add(key);
				const value = node[key];
				if (value instanceof AudioParam) params.add(value);
			}
			proto = Object.getPrototypeOf(proto);
		}
		return params;
	};
	var releaseNodeToPool = (node) => {
		node.disconnect();
		if (node instanceof AudioScheduledSourceNode) return;
		const key = node[POOL_KEY];
		if (key == null) return;
		const now = getNodeTime(node);
		getParams(node).forEach((param) => param.cancelScheduledValues(now));
		const pool = nodePools.get(key) ?? [];
		pool.push(new WeakRef(node));
		nodePools.set(key, pool);
	};
	var isNodeAlive = (node) => {
		if (!(node instanceof AudioWorkletNode)) return true;
		return getNodeTime(node) < (node?.parameters?.get("end").value ?? 0) + .45;
	};
	var getNodeFromPool = (key, factory) => {
		const pool = nodePools.get(key) ?? [];
		let node;
		let found = false;
		while (pool.length) {
			node = pool.pop()?.deref();
			if (node != null && isNodeAlive(node)) {
				found = true;
				break;
			}
		}
		if (!found) node = factory();
		node[POOL_KEY] = key;
		return node;
	};
	//#endregion
	//#region node_modules/superdough/util.mjs
	var tokenizeNote = (note) => {
		if (typeof note !== "string") return [];
		const [pc, acc = "", oct] = note.match(/^([a-gA-G])([#bsf]*)(-?[0-9]*)$/)?.slice(1) || [];
		if (!pc) return [];
		return [
			pc,
			acc,
			oct ? Number(oct) : void 0
		];
	};
	var chromas = {
		c: 0,
		d: 2,
		e: 4,
		f: 5,
		g: 7,
		a: 9,
		b: 11
	};
	var accs = {
		"#": 1,
		b: -1,
		s: 1,
		f: -1
	};
	var getAccidentalsOffset = (accidentals) => {
		return accidentals?.split("").reduce((o, char) => o + accs[char], 0) || 0;
	};
	var noteToMidi = (note, defaultOctave = 3) => {
		const [pc, acc, oct = defaultOctave] = tokenizeNote(note);
		if (!pc) throw new Error("not a note: \"" + note + "\"");
		const chroma = chromas[pc.toLowerCase()];
		const offset = getAccidentalsOffset(acc);
		return (Number(oct) + 1) * 12 + chroma + offset;
	};
	var midiToFreq = (n) => {
		return Math.pow(2, (n - 69) / 12) * 440;
	};
	var clamp = (num, min, max) => Math.min(Math.max(num, min), max);
	function nanFallback(value, fallback = 0, silent) {
		if (isNaN(Number(value))) {
			!silent && logger(`"${value}" is not a number, falling back to ${fallback}`, "warning");
			return fallback;
		}
		return value;
	}
	var _mod$1 = (n, m) => (n % m + m) % m;
	function cycleToSeconds(cycle, cps) {
		return cycle / cps;
	}
	/** Selects entries from `source` and renames them via `map` */
	var pickAndRename = (source, map) => {
		return Object.fromEntries(Object.entries(map).map(([newKey, oldKey]) => [newKey, source[oldKey]]));
	};
	//#endregion
	//#region node_modules/superdough/helpers.mjs
	var noises = [
		"pink",
		"white",
		"brown",
		"crackle"
	];
	function gainNode(value) {
		const node = getAudioContext().createGain();
		node.gain.value = value;
		return node;
	}
	function effectSend(input, effect, wet) {
		const send = gainNode(wet);
		input.connect(send);
		send.connect(effect);
		return send;
	}
	var getSlope = (y1, y2, x1, x2) => {
		if (x2 - x1 === 0) return 0;
		return (y2 - y1) / (x2 - x1);
	};
	function getWorklet(ac, processor, params, config) {
		const node = new AudioWorkletNode(ac, processor, config);
		Object.entries(params).forEach(([key, value]) => {
			if (value !== void 0) node.parameters.get(key).value = value;
		});
		return node;
	}
	var getParamADSR = (param, attack, decay, sustain, release, min, max, begin, end, curve = "exponential") => {
		attack = nanFallback(attack);
		decay = nanFallback(decay);
		sustain = nanFallback(sustain);
		release = nanFallback(release);
		const ramp = curve === "exponential" ? "exponentialRampToValueAtTime" : "linearRampToValueAtTime";
		if (curve === "exponential") {
			min = min === 0 ? .001 : min;
			max = max === 0 ? .001 : max;
		}
		const range = max - min;
		const sustainVal = min + sustain * range;
		const duration = end - begin;
		const envValAtTime = (time) => {
			let val;
			if (attack > time) val = time * getSlope(min, max, 0, attack) + min;
			else val = (time - attack) * getSlope(max, sustainVal, 0, decay) + max;
			if (curve === "exponential") val = val || .001;
			return val;
		};
		param.setValueAtTime(min, begin);
		if (attack > duration) param[ramp](envValAtTime(duration), end);
		else if (attack + decay > duration) {
			param[ramp](envValAtTime(attack), begin + attack);
			param[ramp](envValAtTime(duration), end);
		} else {
			param[ramp](envValAtTime(attack), begin + attack);
			param[ramp](envValAtTime(attack + decay), begin + attack + decay);
			param.setValueAtTime(sustainVal, end);
		}
		param[ramp](min, end + release);
	};
	function getModulationShapeInput(val) {
		if (typeof val === "number") return val % 5;
		return {
			tri: 0,
			triangle: 0,
			sine: 1,
			ramp: 2,
			saw: 3,
			square: 4
		}[val] ?? 0;
	}
	function getEnvelope(audioContext, properties = {}) {
		return getWorklet(audioContext, "envelope-processor", properties);
	}
	function getLfo(audioContext, properties = {}) {
		const { shape = 0, begin = 0, end = 0, time, depth = 1, dcoffset = -.5, frequency = 1, skew = .5, phaseoffset = 0, curve = 1, min, max, ...props } = properties;
		return getWorklet(audioContext, "lfo-processor", {
			begin,
			end,
			time: time ?? begin,
			depth,
			dcoffset,
			frequency,
			skew,
			phaseoffset,
			curve,
			shape: getModulationShapeInput(shape),
			min: min ?? dcoffset * depth,
			max: max ?? dcoffset * depth + depth,
			...props
		});
	}
	function getCompressor(ac, threshold, ratio, knee, attack, release) {
		const node = getNodeFromPool("compressor", () => new DynamicsCompressorNode(ac, {}));
		Object.entries({
			threshold: threshold ?? -3,
			ratio: ratio ?? 10,
			knee: knee ?? 10,
			attack: attack ?? .005,
			release: release ?? .05
		}).forEach(([key, value]) => {
			node[key].value = value;
		});
		return node;
	}
	var getADSRValues = (params, curve = "linear", defaultValues) => {
		const envmin = curve === "exponential" ? .001 : .001;
		const releaseMin = .01;
		const envmax = 1;
		const [a, d, s, r] = params;
		if (a == null && d == null && s == null && r == null) return defaultValues ?? [
			envmin,
			envmin,
			envmax,
			releaseMin
		];
		return [
			Math.max(a ?? 0, envmin),
			Math.max(d ?? 0, envmin),
			Math.min(s != null ? s : a != null && d == null || a == null && d == null ? envmax : envmin, envmax),
			Math.max(r ?? 0, releaseMin)
		];
	};
	function getParamLfo(audioContext, param, start, end, lfoValues) {
		let { defaultDepth = 1, depth, dcoffset, ...getLfoInputs } = lfoValues;
		if (depth == null) depth = Object.values(getLfoInputs).some((v) => v != null) ? defaultDepth : 0;
		let lfo;
		if (depth) {
			lfo = getLfo(audioContext, {
				begin: start,
				end,
				depth,
				dcoffset,
				...getLfoInputs
			});
			lfo.connect(param);
		}
		return lfo;
	}
	function createFilter(context, start, end, params, cps, cycle) {
		let { frequency, anchor, env, type, model, q = 1, drive = .69, depth, depthfrequency, dcoffset = -.5, skew, shape, rate, sync } = params;
		let frequencyParam, filter;
		if (model === "ladder") {
			filter = getWorklet(context, "ladder-processor", {
				frequency,
				q,
				drive
			});
			frequencyParam = filter.parameters.get("frequency");
		} else {
			const factory = () => context.createBiquadFilter();
			filter = getNodeFromPool("filter", factory);
			filter.type = type;
			Object.entries({
				Q: q,
				frequency
			}).forEach(([key, value]) => {
				filter[key].value = value;
			});
			frequencyParam = filter.frequency;
		}
		const envelopeValues = [
			params.attack,
			params.decay,
			params.sustain,
			params.release
		];
		const [attack, decay, sustain, release] = getADSRValues(envelopeValues, "exponential", [
			.005,
			.14,
			0,
			.1
		]);
		if ([...envelopeValues, env].some((v) => v !== void 0)) {
			env = nanFallback(env, 1, true);
			anchor = nanFallback(anchor, 0, true);
			const envAbs = Math.abs(env);
			const offset = envAbs * anchor;
			let min = clamp(2 ** -offset * frequency, 0, 2e4);
			let max = clamp(2 ** (envAbs - offset) * frequency, 0, 2e4);
			if (env < 0) [min, max] = [max, min];
			getParamADSR(frequencyParam, attack, decay, sustain, release, min, max, start, end, "exponential");
		}
		if (sync != null) rate = cps * sync;
		const hasLFO = [
			depth,
			depthfrequency,
			skew,
			shape,
			rate
		].some((v) => v !== void 0);
		let lfo;
		if (hasLFO) {
			depth = depth ?? 1;
			const time = cycle / cps;
			const lfoValues = {
				depth: depthfrequency ?? (depth ?? 1) * frequency,
				dcoffset,
				skew,
				shape,
				frequency: rate ?? cps,
				min: -frequency + 30,
				max: 2e4 - frequency,
				time,
				curve: 1
			};
			lfo = getParamLfo(context, frequencyParam, start, end, lfoValues);
		}
		return {
			filter,
			lfo
		};
	}
	var wetfade = (d) => d < .5 ? 1 : 1 - (d - .5) / .5;
	function drywet(dry, wet, wetAmount = 0) {
		const ac = getAudioContext();
		if (!wetAmount) return dry;
		let dry_gain = ac.createGain();
		let wet_gain = ac.createGain();
		dry.connect(dry_gain);
		wet.connect(wet_gain);
		dry_gain.gain.value = wetfade(wetAmount);
		wet_gain.gain.value = wetfade(1 - wetAmount);
		let mix = ac.createGain();
		dry_gain.connect(mix);
		wet_gain.connect(mix);
		return {
			node: mix,
			teardown: () => {
				releaseAudioNode(dry_gain);
				releaseAudioNode(wet_gain);
				dry.disconnect(dry_gain);
				wet.disconnect(wet_gain);
			}
		};
	}
	var curves = ["linear", "exponential"];
	function getPitchEnvelope(param, value, t, holdEnd) {
		if ((value.pattack ?? value.pdecay ?? value.psustain ?? value.prelease ?? value.penv) === void 0) return;
		const penv = nanFallback(value.penv, 1, true);
		const curve = curves[value.pcurve ?? 0];
		let [pattack, pdecay, psustain, prelease] = getADSRValues([
			value.pattack,
			value.pdecay,
			value.psustain,
			value.prelease
		], curve, [
			.2,
			.001,
			1,
			.001
		]);
		let panchor = value.panchor ?? psustain;
		const cents = penv * 100;
		getParamADSR(param, pattack, pdecay, psustain, prelease, 0 - cents * panchor, cents - cents * panchor, t, holdEnd, curve);
	}
	function getVibratoOscillator(param, value, t) {
		const { vibmod = .5, vib } = value;
		let vibratoOscillator;
		if (vib > 0) {
			vibratoOscillator = getAudioContext().createOscillator();
			vibratoOscillator.frequency.value = vib;
			const gain = getAudioContext().createGain();
			gain.gain.value = vibmod * 100;
			vibratoOscillator.connect(gain);
			gain.connect(param);
			onceEnded(vibratoOscillator, () => {
				releaseAudioNode(gain);
				releaseAudioNode(vibratoOscillator);
			});
			vibratoOscillator.start(t);
			return {
				stop: (t) => vibratoOscillator.stop(t),
				nodes: {
					vib: [vibratoOscillator],
					vib_gain: [gain]
				}
			};
		}
	}
	function webAudioTimeout(audioContext, onComplete, startTime, stopTime) {
		const constantNode = new ConstantSourceNode(audioContext);
		const zeroGain = gainNode(0);
		zeroGain.connect(audioContext.destination);
		constantNode.connect(zeroGain);
		onceEnded(constantNode, () => {
			releaseAudioNode(zeroGain);
			releaseAudioNode(constantNode);
			onComplete();
		});
		constantNode.start(startTime);
		constantNode.stop(stopTime);
		return constantNode;
	}
	var mod = (freq, type = "sine") => {
		const ctx = getAudioContext();
		let osc;
		if (noises.includes(type)) {
			osc = ctx.createBufferSource();
			osc.buffer = getNoiseBuffer(type, 2);
			osc.loop = true;
		} else {
			osc = ctx.createOscillator();
			osc.type = type;
			osc.frequency.value = freq;
		}
		osc.start();
		return osc;
	};
	var fm = (frequencyparam, harmonicityRatio, wave = "sine") => {
		const modfreq = frequencyparam.value * harmonicityRatio;
		return {
			osc: mod(modfreq, wave),
			freq: modfreq
		};
	};
	function applyFM(param, value, begin) {
		const ac = getAudioContext();
		const toStop = [];
		const fms = {};
		const nodes = {};
		for (let i = 1; i <= 8; i++) for (let j = 0; j <= 8; j++) {
			let control;
			if (i === j + 1) control = `fmi${i === 1 ? "" : i}`;
			else control = `fmi${i}${j}`;
			const amt = value[control];
			if (!amt) continue;
			let io = [];
			for (let [isMod, idx] of [[true, i], [false, j]]) {
				if (idx === 0) {
					io.push(param);
					continue;
				}
				if (!fms[idx]) {
					const idxS = idx === 1 ? "" : idx;
					const { osc, freq } = fm(param, value[`fmh${idxS}`] ?? 1, value[`fmwave${idxS}`] ?? "sine");
					toStop.push(osc);
					const toCleanup = [osc];
					const adsr = [
						"attack",
						"decay",
						"sustain",
						"release"
					].map((s) => value[`fm${s}${idxS}`]);
					let output = osc;
					if (adsr.some((v) => v !== void 0)) {
						const envGain = ac.createGain();
						const [attack, decay, sustain, release] = getADSRValues(adsr);
						const holdEnd = begin + value.duration;
						const fmEnvelopeType = value[`fmenv${idxS}`] ?? "exp";
						getParamADSR(envGain.gain, attack, decay, sustain, release, 0, 1, begin, holdEnd, fmEnvelopeType === "exp" ? "exponential" : "linear");
						toCleanup.push(envGain);
						output = osc.connect(envGain);
					}
					fms[idx] = {
						input: osc.frequency,
						output,
						freq,
						osc,
						toCleanup
					};
					nodes[`fm_${idx}`] = [osc];
				}
				const { input, output, freq, osc, toCleanup } = fms[idx];
				const gAmt = gainNode(amt);
				const gFreq = gainNode(freq);
				io.push(isMod ? output.connect(gAmt).connect(gFreq) : input);
				cleanupOnEnd(osc, [
					...toCleanup,
					gAmt,
					gFreq
				]);
				nodes[`fm_${idx}_gain`] = [gAmt];
			}
			if (!io[1]) {
				logger(`[superdough] control ${control} failed to connect FM ${i} to target ${j} due to missing frequency parameter (likely because fm${j} is noise)`, "warning");
				continue;
			}
			io[0].connect(io[1]);
		}
		return {
			nodes,
			stop: (t) => toStop.forEach((m) => m?.stop(t))
		};
	}
	var __squash = (x) => x / (1 + x);
	var _mod = (n, m) => (n % m + m) % m;
	var _scurve = (x, k) => (1 + k) * x / (1 + k * Math.abs(x));
	var _soft = (x, k) => Math.tanh(x * (1 + k));
	var _hard = (x, k) => clamp((1 + k) * x, -1, 1);
	var _fold = (x, k) => {
		const window = _mod((1 + .5 * k) * x + 1, 4);
		return 1 - Math.abs(window - 2);
	};
	var _sineFold = (x, k) => Math.sin(Math.PI / 2 * _fold(x, k));
	var _cubic = (x, k) => {
		const t = __squash(Math.log1p(k));
		return _soft((x - t / 3 * x * x * x) / (1 - t / 3), k);
	};
	var _diode = (x, k, asym = false) => {
		const g = 1 + 2 * k;
		const bias = .07 * __squash(Math.log1p(k));
		const y = _soft(x + bias, 2 * k) - _soft(asym ? bias : -x + bias, 2 * k);
		const sech = 1 / Math.cosh(g * bias);
		const sech2 = sech * sech;
		return _soft(y / Math.max(1e-8, (asym ? 1 : 2) * g * sech2), k);
	};
	var _asym = (x, k) => _diode(x, k, true);
	var _chebyshev = (x, k) => {
		const kl = 10 * Math.log1p(k);
		let tnm1 = 1;
		let tnm2 = x;
		let tn;
		let y = 0;
		for (let i = 1; i < 64; i++) {
			if (i < 2) {
				y += i == 0 ? tnm1 : tnm2;
				continue;
			}
			tn = 2 * x * tnm1 - tnm2;
			tnm2 = tnm1;
			tnm1 = tn;
			if (i % 2 === 0) y += Math.min(1.3 * kl / i, 2) * tn;
		}
		return _soft(y, kl / 20);
	};
	Object.freeze(Object.keys({
		scurve: _scurve,
		soft: _soft,
		hard: _hard,
		cubic: _cubic,
		diode: _diode,
		asym: _asym,
		fold: _fold,
		sinefold: _sineFold,
		chebyshev: _chebyshev
	}));
	var getDistortion = (distort, postgain, algorithm) => {
		return getWorklet(getAudioContext(), "distort-processor", {
			distort,
			postgain
		}, { processorOptions: { algorithm } });
	};
	var getFrequencyFromValue = (value, defaultNote = 36) => {
		let { note, freq, octave = 0 } = value;
		note = note || defaultNote;
		if (typeof note === "string") note = noteToMidi(note);
		if (!freq && typeof note === "number") freq = midiToFreq(note);
		freq *= Math.pow(2, octave);
		return Number(freq);
	};
	var onceEnded = (node, callback) => {
		const onended = callback;
		node.onended = function cleanup() {
			onended && onended();
			this.onended = null;
		};
	};
	var releaseAudioNode = (node) => {
		if (node == null) return;
		if (!(node instanceof AudioNode)) throw new Error("releaseAudioNode can only release an AudioNode");
		node.disconnect();
		if (node instanceof AudioScheduledSourceNode) try {
			node.stop();
		} catch (e) {
			node.start(node.context.currentTime + 5);
			node.stop();
		}
		if (node instanceof AudioWorkletNode) node.parameters.get("end")?.setValueAtTime(0, 0);
	};
	var cleanupOnEnd = (anchor, toCleanup) => {
		onceEnded(anchor, () => toCleanup.forEach((n) => releaseAudioNode(n)));
	};
	//#endregion
	//#region node_modules/superdough/reverbGen.mjs
	var reverbGen = {};
	/** Generates a reverb impulse response.
	
	@param {!Object} params TODO: Document the properties.
	@param {!function(!AudioBuffer)} callback Function to call when
	the impulse response has been generated. The impulse response
	is passed to this function as its parameter. May be called
	immediately within the current execution context, or later. */
	reverbGen.generateReverb = function(params, callback) {
		var audioContext = params.audioContext || new AudioContext();
		var sampleRate = audioContext.sampleRate;
		var numChannels = params.numChannels || 2;
		var totalTime = params.decayTime * 1.5;
		var decaySampleFrames = Math.round(params.decayTime * sampleRate);
		var numSampleFrames = Math.round(totalTime * sampleRate);
		var fadeInSampleFrames = Math.round((params.fadeInTime || 0) * sampleRate);
		var decayBase = Math.pow(1 / 1e3, 1 / decaySampleFrames);
		var reverbIR = audioContext.createBuffer(numChannels, numSampleFrames, sampleRate);
		for (var i = 0; i < numChannels; i++) {
			var chan = reverbIR.getChannelData(i);
			for (var j = 0; j < numSampleFrames; j++) chan[j] = randomSample() * Math.pow(decayBase, j);
			for (var j = 0; j < fadeInSampleFrames; j++) chan[j] *= j / fadeInSampleFrames;
		}
		applyGradualLowpass(reverbIR, params.lpFreqStart || 0, params.lpFreqEnd || 0, params.decayTime, callback);
	};
	/** Creates a canvas element showing a graph of the given data.
	
	
	@param {!Float32Array} data An array of numbers, or a Float32Array.
	@param {number} width Width in pixels of the canvas.
	@param {number} height Height in pixels of the canvas.
	@param {number} min Minimum value of data for the graph (lower edge).
	@param {number} max Maximum value of data in the graph (upper edge).
	@return {!CanvasElement} The generated canvas element. */
	reverbGen.generateGraph = function(data, width, height, min, max) {
		var canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		var gc = canvas.getContext("2d");
		gc.fillStyle = "#000";
		gc.fillRect(0, 0, canvas.width, canvas.height);
		gc.fillStyle = "#fff";
		var xscale = width / data.length;
		var yscale = height / (max - min);
		for (var i = 0; i < data.length; i++) gc.fillRect(i * xscale, height - (data[i] - min) * yscale, 1, 1);
		return canvas;
	};
	/** Applies a constantly changing lowpass filter to the given sound.
	
	@private
	@param {!AudioBuffer} input
	@param {number} lpFreqStart
	@param {number} lpFreqEnd
	@param {number} lpFreqEndAt
	@param {!function(!AudioBuffer)} callback May be called
	immediately within the current execution context, or later.*/
	var applyGradualLowpass = function(input, lpFreqStart, lpFreqEnd, lpFreqEndAt, callback) {
		if (lpFreqStart == 0) {
			callback(input);
			return;
		}
		var channelData = getAllChannelData(input);
		var context = new OfflineAudioContext(input.numberOfChannels, channelData[0].length, input.sampleRate);
		var player = context.createBufferSource();
		player.buffer = input;
		var filter = context.createBiquadFilter();
		lpFreqStart = Math.min(lpFreqStart, input.sampleRate / 2);
		lpFreqEnd = Math.min(lpFreqEnd, input.sampleRate / 2);
		filter.type = "lowpass";
		filter.Q.value = 1e-4;
		filter.frequency.setValueAtTime(lpFreqStart, 0);
		filter.frequency.linearRampToValueAtTime(lpFreqEnd, lpFreqEndAt);
		player.connect(filter);
		filter.connect(context.destination);
		player.start();
		context.oncomplete = function(event) {
			callback(event.renderedBuffer);
			releaseAudioNode(filter);
			releaseAudioNode(player);
		};
		context.startRendering();
		window.filterNode = filter;
	};
	/** @private
	@param {!AudioBuffer} buffer
	@return {!Array.<!Float32Array>} An array containing the Float32Array of each channel's samples. */
	var getAllChannelData = function(buffer) {
		var channels = [];
		for (var i = 0; i < buffer.numberOfChannels; i++) channels[i] = buffer.getChannelData(i);
		return channels;
	};
	/** @private
	@return {number} A random number from -1 to 1. */
	var randomSample = function() {
		return Math.random() * 2 - 1;
	};
	//#endregion
	//#region node_modules/superdough/reverb.mjs
	if (typeof AudioContext !== "undefined") {
		BaseAudioContext.prototype.adjustLength = function(duration, buffer, speed = 1, offsetAmount = 0) {
			const sampleOffset = Math.floor(clamp(offsetAmount, 0, 1) * buffer.length);
			const newLength = buffer.sampleRate * duration;
			const newBuffer = this.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
			for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
				let oldData = buffer.getChannelData(channel);
				let newData = newBuffer.getChannelData(channel);
				for (let i = 0; i < newLength; i++) {
					let position = (sampleOffset + i * Math.abs(speed)) % oldData.length;
					if (speed < 1) position = position * -1;
					newData[i] = oldData.at(position) || 0;
				}
			}
			return newBuffer;
		};
		BaseAudioContext.prototype.createReverb = function(duration, fade, lp, dim, ir, irspeed, irbegin) {
			const convolver = this.createConvolver();
			convolver.generate = (d = 2, fade = .1, lp = 15e3, dim = 1e3, ir, irspeed, irbegin) => {
				convolver.duration = d;
				convolver.fade = fade;
				convolver.lp = lp;
				convolver.dim = dim;
				convolver.ir = ir;
				convolver.irspeed = irspeed;
				convolver.irbegin = irbegin;
				if (ir) convolver.buffer = this.adjustLength(d, ir, irspeed, irbegin);
				else reverbGen.generateReverb({
					audioContext: this,
					numChannels: 2,
					decayTime: d,
					fadeInTime: fade,
					lpFreqStart: lp,
					lpFreqEnd: dim
				}, (buffer) => {
					convolver.buffer = buffer;
				});
			};
			convolver.generate(duration, fade, lp, dim, ir, irspeed, irbegin);
			return convolver;
		};
	}
	//#endregion
	//#region node_modules/superdough/vowel.mjs
	var vowelFormant = {
		a: {
			freqs: [
				660,
				1120,
				2750,
				3e3,
				3350
			],
			gains: [
				1,
				.5012,
				.0708,
				.0631,
				.0126
			],
			qs: [
				80,
				90,
				120,
				130,
				140
			]
		},
		e: {
			freqs: [
				440,
				1800,
				2700,
				3e3,
				3300
			],
			gains: [
				1,
				.1995,
				.1259,
				.1,
				.1
			],
			qs: [
				70,
				80,
				100,
				120,
				120
			]
		},
		i: {
			freqs: [
				270,
				1850,
				2900,
				3350,
				3590
			],
			gains: [
				1,
				.0631,
				.0631,
				.0158,
				.0158
			],
			qs: [
				40,
				90,
				100,
				120,
				120
			]
		},
		o: {
			freqs: [
				430,
				820,
				2700,
				3e3,
				3300
			],
			gains: [
				1,
				.3162,
				.0501,
				.0794,
				.01995
			],
			qs: [
				40,
				80,
				100,
				120,
				120
			]
		},
		u: {
			freqs: [
				370,
				630,
				2750,
				3e3,
				3400
			],
			gains: [
				1,
				.1,
				.0708,
				.0316,
				.01995
			],
			qs: [
				40,
				60,
				100,
				120,
				120
			]
		},
		ae: {
			freqs: [
				650,
				1515,
				2400,
				3e3,
				3350
			],
			gains: [
				1,
				.5,
				.1008,
				.0631,
				.0126
			],
			qs: [
				80,
				90,
				120,
				130,
				140
			]
		},
		aa: {
			freqs: [
				560,
				900,
				2570,
				3e3,
				3300
			],
			gains: [
				1,
				.5,
				.0708,
				.0631,
				.0126
			],
			qs: [
				80,
				90,
				120,
				130,
				140
			]
		},
		oe: {
			freqs: [
				500,
				1430,
				2300,
				3e3,
				3300
			],
			gains: [
				1,
				.2,
				.0708,
				.0316,
				.01995
			],
			qs: [
				40,
				60,
				100,
				120,
				120
			]
		},
		ue: {
			freqs: [
				250,
				1750,
				2150,
				3200,
				3300
			],
			gains: [
				1,
				.1,
				.0708,
				.0316,
				.01995
			],
			qs: [
				40,
				60,
				100,
				120,
				120
			]
		},
		y: {
			freqs: [
				400,
				1460,
				2400,
				3e3,
				3300
			],
			gains: [
				1,
				.2,
				.0708,
				.0316,
				.02995
			],
			qs: [
				40,
				60,
				100,
				120,
				120
			]
		},
		uh: {
			freqs: [
				600,
				1250,
				2100,
				3100,
				3500
			],
			gains: [
				1,
				.3,
				.0608,
				.0316,
				.01995
			],
			qs: [
				40,
				70,
				100,
				120,
				130
			]
		},
		un: {
			freqs: [
				500,
				1240,
				2280,
				3e3,
				3500
			],
			gains: [
				1,
				.1,
				.1708,
				.0216,
				.02995
			],
			qs: [
				40,
				60,
				100,
				120,
				120
			]
		},
		en: {
			freqs: [
				600,
				1480,
				2450,
				3200,
				3300
			],
			gains: [
				1,
				.15,
				.0708,
				.0316,
				.02995
			],
			qs: [
				40,
				60,
				100,
				120,
				120
			]
		},
		an: {
			freqs: [
				700,
				1050,
				2500,
				3e3,
				3300
			],
			gains: [
				1,
				.1,
				.0708,
				.0316,
				.02995
			],
			qs: [
				40,
				60,
				100,
				120,
				120
			]
		},
		on: {
			freqs: [
				500,
				1080,
				2350,
				3e3,
				3300
			],
			gains: [
				1,
				.1,
				.0708,
				.0316,
				.02995
			],
			qs: [
				40,
				60,
				100,
				120,
				120
			]
		},
		get æ() {
			return this.ae;
		},
		get ø() {
			return this.oe;
		},
		get ɑ() {
			return this.aa;
		},
		get å() {
			return this.aa;
		},
		get ö() {
			return this.oe;
		},
		get ü() {
			return this.ue;
		},
		get ı() {
			return this.y;
		}
	};
	if (typeof GainNode !== "undefined") {
		class VowelNode extends GainNode {
			constructor(ac, letter) {
				super(ac);
				if (!vowelFormant[letter]) throw new Error("vowel: unknown vowel " + letter);
				const { gains, qs, freqs } = vowelFormant[letter];
				this.makeupGain = ac.createGain();
				this.filters = [];
				this.gains = [];
				for (let i = 0; i < 5; i++) {
					const gain = ac.createGain();
					gain.gain.value = gains[i];
					const filter = ac.createBiquadFilter();
					filter.type = "bandpass";
					filter.Q.value = qs[i];
					filter.frequency.value = freqs[i];
					super.connect(filter);
					filter.connect(gain);
					this.filters.push(filter);
					gain.connect(this.makeupGain);
					this.gains.push(gain);
				}
				this.makeupGain.gain.value = 8;
				return this;
			}
			connect(target) {
				this.makeupGain.connect(target);
			}
			disconnect() {
				releaseAudioNode(this.makeupGain);
				this.filters.forEach(releaseAudioNode);
				this.gains.forEach(releaseAudioNode);
				super.disconnect();
				this.makeupGain = null;
				this.filters = null;
				this.gains = null;
			}
		}
		BaseAudioContext.prototype.createVowelFilter = function(letter) {
			return new VowelNode(this, letter);
		};
	}
	//#endregion
	//#region \0room-worklet-url
	var _room_worklet_url_default = new URL("worklets.js", document.baseURI).href;
	//#endregion
	//#region node_modules/nanostores/atom/index.js
	var listenerQueue = [];
	var lqIndex = 0;
	var QUEUE_ITEMS_PER_LISTENER = 4;
	var epoch = 0;
	var atom = (initialValue) => {
		let listeners = [];
		let $atom = {
			get() {
				if (!$atom.lc) $atom.listen(() => {})();
				return $atom.value;
			},
			lc: 0,
			listen(listener) {
				$atom.lc = listeners.push(listener);
				return () => {
					for (let i = lqIndex + QUEUE_ITEMS_PER_LISTENER; i < listenerQueue.length;) if (listenerQueue[i] === listener) listenerQueue.splice(i, QUEUE_ITEMS_PER_LISTENER);
					else i += QUEUE_ITEMS_PER_LISTENER;
					let index = listeners.indexOf(listener);
					if (~index) {
						listeners.splice(index, 1);
						if (!--$atom.lc) $atom.off();
					}
				};
			},
			notify(oldValue, changedKey) {
				epoch++;
				let runListenerQueue = !listenerQueue.length;
				for (let listener of listeners) listenerQueue.push(listener, $atom.value, oldValue, changedKey);
				if (runListenerQueue) {
					for (lqIndex = 0; lqIndex < listenerQueue.length; lqIndex += QUEUE_ITEMS_PER_LISTENER) listenerQueue[lqIndex](listenerQueue[lqIndex + 1], listenerQueue[lqIndex + 2], listenerQueue[lqIndex + 3]);
					listenerQueue.length = 0;
				}
			},
			off() {},
			set(newValue) {
				let oldValue = $atom.value;
				if (oldValue !== newValue) {
					$atom.value = newValue;
					$atom.notify(oldValue);
				}
			},
			subscribe(listener) {
				let unbind = $atom.listen(listener);
				listener($atom.value);
				return unbind;
			},
			value: initialValue
		};
		return $atom;
	};
	//#endregion
	//#region node_modules/nanostores/map/index.js
	var map = (initial = {}) => {
		let $map = atom(initial);
		$map.setKey = function(key, value) {
			let oldMap = $map.value;
			if (typeof value === "undefined" && key in $map.value) {
				$map.value = { ...$map.value };
				delete $map.value[key];
				$map.notify(oldMap, key);
			} else if ($map.value[key] !== value) {
				$map.value = {
					...$map.value,
					[key]: value
				};
				$map.notify(oldMap, key);
			}
		};
		return $map;
	};
	//#endregion
	//#region node_modules/superdough/superdoughdata.mjs
	var CONTROL_TARGETS = {
		stretch: {
			node: "stretch",
			param: "pitchFactor"
		},
		gain: {
			node: "gain",
			param: "gain"
		},
		postgain: {
			node: "post",
			param: "gain"
		},
		pan: {
			node: "pan",
			param: "pan"
		},
		tremolo: {
			node: "tremolo",
			param: "frequency"
		},
		tremolosync: {
			node: "tremolo",
			param: "frequency"
		},
		tremolodepth: {
			node: "tremolo_gain",
			param: "gain"
		},
		tremoloskew: {
			node: "tremolo",
			param: "skew"
		},
		tremolophase: {
			node: "tremolo",
			param: "phase"
		},
		tremoloshape: {
			node: "tremolo",
			param: "shape"
		},
		lfo: {
			node: "lfo",
			param: "frequency"
		},
		lfo_rate: {
			node: "lfo",
			param: "frequency"
		},
		lfo_sync: {
			node: "lfo",
			param: "frequency"
		},
		lfo_depth: {
			node: "lfo",
			param: "depth"
		},
		lfo_depthabs: {
			node: "lfo",
			param: "depth"
		},
		lfo_skew: {
			node: "lfo",
			param: "skew"
		},
		lfo_curve: {
			node: "lfo",
			param: "curve"
		},
		lfo_dcoffset: {
			node: "lfo",
			param: "dcoffset"
		},
		env: {
			node: "env",
			param: "depth"
		},
		env_attack: {
			node: "env",
			param: "attack"
		},
		env_decay: {
			node: "env",
			param: "decay"
		},
		env_sustain: {
			node: "env",
			param: "sustain"
		},
		env_release: {
			node: "env",
			param: "release"
		},
		bmod: {
			node: "bmod",
			param: "depth"
		},
		bmod_depth: {
			node: "bmod",
			param: "depth"
		},
		bmod_depthabs: {
			node: "bmod",
			param: "depth"
		},
		cutoff: {
			node: "lpf",
			param: "frequency"
		},
		resonance: {
			node: "lpf",
			param: "Q"
		},
		lprate: {
			node: "lpf_lfo",
			param: "rate"
		},
		lpsync: {
			node: "lpf_lfo",
			param: "sync"
		},
		lpdepth: {
			node: "lpf_lfo",
			param: "depth"
		},
		lpdepthfrequency: {
			node: "lpf_lfo",
			param: "depth"
		},
		lpshape: {
			node: "lpf_lfo",
			param: "shape"
		},
		lpdc: {
			node: "lpf_lfo",
			param: "dcoffset"
		},
		lpskew: {
			node: "lpf_lfo",
			param: "skew"
		},
		hcutoff: {
			node: "hpf",
			param: "frequency"
		},
		hresonance: {
			node: "hpf",
			param: "Q"
		},
		hprate: {
			node: "hpf_lfo",
			param: "rate"
		},
		hpsync: {
			node: "hpf_lfo",
			param: "sync"
		},
		hpdepth: {
			node: "hpf_lfo",
			param: "depth"
		},
		hpdepthfrequency: {
			node: "hpf_lfo",
			param: "depth"
		},
		hpshape: {
			node: "hpf_lfo",
			param: "shape"
		},
		hpdc: {
			node: "hpf_lfo",
			param: "dcoffset"
		},
		hpskew: {
			node: "hpf_lfo",
			param: "skew"
		},
		bandf: {
			node: "bpf",
			param: "frequency"
		},
		bandq: {
			node: "bpf",
			param: "Q"
		},
		bprate: {
			node: "bpf_lfo",
			param: "rate"
		},
		bpsync: {
			node: "bpf_lfo",
			param: "sync"
		},
		bpdepth: {
			node: "bpf_lfo",
			param: "depth"
		},
		bpdepthfrequency: {
			node: "bpf_lfo",
			param: "depth"
		},
		bpshape: {
			node: "bpf_lfo",
			param: "shape"
		},
		bpdc: {
			node: "bpf_lfo",
			param: "dcoffset"
		},
		bpskew: {
			node: "bpf_lfo",
			param: "skew"
		},
		vowel: {
			node: "vowel",
			param: "frequency"
		},
		coarse: {
			node: "coarse",
			param: "coarse"
		},
		crush: {
			node: "crush",
			param: "crush"
		},
		shape: {
			node: "shape",
			param: "shape"
		},
		shapevol: {
			node: "shape",
			param: "postgain"
		},
		distort: {
			node: "distort",
			param: "distort"
		},
		distortvol: {
			node: "distort",
			param: "postgain"
		},
		distorttype: {
			node: "distort",
			param: "distort"
		},
		compressor: {
			node: "compressor",
			param: "threshold"
		},
		compressorRatio: {
			node: "compressor",
			param: "ratio"
		},
		compressorKnee: {
			node: "compressor",
			param: "knee"
		},
		compressorAttack: {
			node: "compressor",
			param: "attack"
		},
		compressorRelease: {
			node: "compressor",
			param: "release"
		},
		phaserrate: {
			node: "phaser_lfo",
			param: "frequency"
		},
		phasersweep: {
			node: "phaser_lfo",
			param: "depth"
		},
		phasercenter: {
			node: "phaser",
			param: "frequency"
		},
		phaserdepth: {
			node: "phaser",
			param: "Q"
		},
		delay: {
			node: "delay_mix",
			param: "gain"
		},
		delaytime: {
			node: "delay",
			param: "delayTime"
		},
		delayfeedback: {
			node: "delay",
			param: "feedback"
		},
		delaysync: {
			node: "delay",
			param: "delayTime"
		},
		dry: {
			node: "dry",
			param: "gain"
		},
		room: {
			node: "room_mix",
			param: "gain"
		},
		djf: {
			node: "djf",
			param: "value"
		},
		busgain: {
			node: "bus",
			param: "gain"
		},
		s: {
			node: "source",
			param: "frequency"
		},
		detune: {
			node: "source",
			param: "freqspread"
		},
		wt: {
			node: "source",
			param: "position"
		},
		warp: {
			node: "source",
			param: "warp"
		},
		freq: {
			node: "source",
			param: "frequency"
		},
		note: {
			node: "source",
			param: "frequency"
		},
		wtdc: {
			node: "wt_lfo",
			param: "dc"
		},
		wtskew: {
			node: "wt_lfo",
			param: "skew"
		},
		wtrate: {
			node: "wt_lfo",
			param: "frequency"
		},
		wtsync: {
			node: "wt_lfo",
			param: "frequency"
		},
		wtdepth: {
			node: "wt_lfo",
			param: "depth"
		},
		warpdc: {
			node: "warp_lfo",
			param: "dc"
		},
		warpskew: {
			node: "warp_lfo",
			param: "skew"
		},
		warprate: {
			node: "warp_lfo",
			param: "frequency"
		},
		warpsync: {
			node: "warp_lfo",
			param: "frequency"
		},
		warpdepth: {
			node: "warp_lfo",
			param: "depth"
		},
		fmi: {
			node: "fm_1_gain",
			param: "gain"
		},
		fmi2: {
			node: "fm_2_gain",
			param: "gain"
		},
		fmi3: {
			node: "fm_3_gain",
			param: "gain"
		},
		fmi4: {
			node: "fm_4_gain",
			param: "gain"
		},
		fmi5: {
			node: "fm_5_gain",
			param: "gain"
		},
		fmi6: {
			node: "fm_6_gain",
			param: "gain"
		},
		fmi7: {
			node: "fm_7_gain",
			param: "gain"
		},
		fmi8: {
			node: "fm_8_gain",
			param: "gain"
		},
		fmh: {
			node: "fm_1",
			param: "frequency"
		},
		fmh2: {
			node: "fm_2",
			param: "frequency"
		},
		fmh3: {
			node: "fm_3",
			param: "frequency"
		},
		fmh4: {
			node: "fm_4",
			param: "frequency"
		},
		fmh5: {
			node: "fm_5",
			param: "frequency"
		},
		fmh6: {
			node: "fm_6",
			param: "frequency"
		},
		fmh7: {
			node: "fm_7",
			param: "frequency"
		},
		fmh8: {
			node: "fm_8",
			param: "frequency"
		},
		pw: {
			node: "source",
			param: "pulsewidth"
		},
		pwrate: {
			node: "pw_lfo",
			param: "frequency"
		},
		pwsweep: {
			node: "pw_lfo",
			param: "depth"
		},
		vib: {
			node: "vib",
			param: "frequency"
		},
		vibmod: {
			node: "vib_gain",
			param: "gain"
		},
		byteBeatStartTime: {
			node: "source",
			param: "byteBeatStartTime"
		},
		spread: {
			node: "source",
			param: "panspread"
		},
		transient: {
			node: "transient",
			param: "attack"
		}
	};
	function getSuperdoughControlTargets() {
		return CONTROL_TARGETS;
	}
	//#endregion
	//#region node_modules/superdough/modulators.mjs
	var getNodeParam = (node, name) => {
		if (node?.parameters) {
			const p = node.parameters.get(name);
			if (p instanceof AudioParam) return p;
		}
		let p = node?.[name];
		if (p === void 0 && name === "frequency") p = node?.["detune"] ?? node?.["playbackRate"];
		if (p instanceof AudioParam) return p;
	};
	var controlTargets = getSuperdoughControlTargets();
	var getControlData = (control, subControl) => {
		const controlNoIdx = control.split("_")[0];
		return controlTargets[`${controlNoIdx}_${subControl}`] ?? controlTargets[controlNoIdx];
	};
	var getRangeForParam = (paramName, currentValue) => {
		if (paramName === "frequency" && currentValue >= 30) return {
			min: 20 - currentValue,
			max: 24e3 - currentValue
		};
		return {
			min: void 0,
			max: void 0
		};
	};
	var clampWithWaveShaper = (modulator, min, max) => {
		const ac = getAudioContext();
		const curve = /* @__PURE__ */ new Float32Array(256);
		for (let i = 0; i < curve.length; i++) {
			const x = i / (curve.length - 1) * 2 - 1;
			curve[i] = clamp(x * max, min, max);
		}
		const shaper = new WaveShaperNode(ac, { curve });
		const scaleGain = gainNode(1 / max);
		modulator.connect(scaleGain).connect(shaper);
		return {
			modulator,
			toCleanup: [shaper, scaleGain]
		};
	};
	var getTargetParamsForControl = (control, nodes, subControl) => {
		const targetInfo = getControlData(control, subControl);
		if (!targetInfo) {
			errorLogger(/* @__PURE__ */ new Error(`Could not find control data for target '${control}'. It may not be modulatable.`), "superdough");
			return {
				targetParams: [],
				paramName: control
			};
		}
		const paramName = targetInfo.param;
		const nodeKey = nodes[targetInfo.node] ? targetInfo.node : control;
		const targetNodes = nodes[nodeKey];
		if (!targetNodes) {
			const keys = Object.keys(nodes);
			errorLogger(/* @__PURE__ */ new Error(`Could not connect to target '${nodeKey}' — it does not exist. Available targets: ${keys.join(", ")}`), "superdough");
			return {
				targetParams: [],
				paramName
			};
		}
		const audioParams = [];
		targetNodes.forEach((targetNode) => {
			const targetParam = getNodeParam(targetNode, paramName);
			audioParams.push(targetParam);
		});
		return {
			targetParams: audioParams,
			paramName
		};
	};
	var connectLFO = (id, params, nodeTracker) => {
		const { rate = 1, sync, cps, cycle, control = "lfo", subControl, fxi = "main", depth = 1, depthabs, ...filteredParams } = params;
		const { targetParams, paramName } = getTargetParamsForControl(control, nodeTracker[fxi], subControl);
		if (!targetParams.length) return;
		let currentValue = targetParams[0].value;
		currentValue = currentValue === 0 ? 1 : currentValue;
		const { min, max } = getRangeForParam(paramName, currentValue);
		const depthValue = depthabs != null ? depthabs : depth * currentValue;
		const modParams = {
			...filteredParams,
			frequency: sync !== void 0 ? sync * cps : rate,
			time: cycle / cps,
			depth: depthValue,
			min,
			max
		};
		const lfoNode = getLfo(getAudioContext(), modParams);
		nodeTracker.main[`lfo_${id}`] = [lfoNode];
		targetParams.forEach((t) => lfoNode.connect(t));
		return lfoNode;
	};
	var connectEnvelope = (id, params, nodeTracker) => {
		const { control, subControl, acurve, dcurve, rcurve, depth = 1, depthabs, fxi = "main", ...filteredParams } = params;
		const { targetParams, paramName } = getTargetParamsForControl(control, nodeTracker[fxi], subControl);
		if (!targetParams.length) return;
		let currentValue = targetParams[0].value;
		currentValue = currentValue === 0 ? 1 : currentValue;
		const { min, max } = getRangeForParam(paramName, currentValue);
		const depthValue = depthabs != null ? depthabs : depth * currentValue;
		const envNode = getEnvelope(getAudioContext(), {
			...filteredParams,
			depth: depthValue,
			min,
			max,
			attackCurve: acurve,
			decayCurve: dcurve,
			releaseCurve: rcurve
		});
		nodeTracker.main[`env_${id}`] = [envNode];
		targetParams.forEach((t) => envNode.connect(t));
		return envNode;
	};
	var connectBusModulator = (params, nodeTracker, controller) => {
		const ac = getAudioContext();
		const { control, subControl, depth = 1, depthabs, fxi = "main" } = params;
		const { targetParams, paramName } = getTargetParamsForControl(control, nodeTracker[fxi], subControl);
		if (!targetParams.length) return { toCleanup: [] };
		const signal = controller.getBus(params.bus);
		const dc = new ConstantSourceNode(ac, { offset: params.dc ?? 0 });
		dc.start(params.begin);
		const shifted = dc.connect(gainNode(1));
		signal.connect(shifted);
		let currentValue = targetParams[0].value;
		currentValue = currentValue === 0 ? 1 : currentValue;
		const { min, max } = getRangeForParam(paramName, currentValue);
		const depthValue = depthabs != null ? depthabs : depth * currentValue;
		const depthGain = gainNode(Math.sign(depthValue) * Math.abs(depthValue) / .3);
		const unClamped = shifted.connect(depthGain);
		const toCleanup = [];
		let modulator = unClamped;
		if (min !== void 0 && max !== void 0) {
			const wsData = clampWithWaveShaper(unClamped, min, max);
			modulator = wsData.modulator;
			toCleanup.push(...wsData.toCleanup);
		}
		webAudioTimeout(ac, () => {
			targetParams.forEach((t) => modulator.connect(t));
		}, 0, params.begin);
		toCleanup.push(dc, shifted, depthGain);
		return {
			modulator,
			toCleanup
		};
	};
	//#endregion
	//#region node_modules/superdough/sampler.mjs
	var bufferCache = {};
	var loadCache = {};
	function humanFileSize(bytes, si) {
		var thresh = si ? 1e3 : 1024;
		if (bytes < thresh) return bytes + " B";
		var units = si ? [
			"kB",
			"MB",
			"GB",
			"TB",
			"PB",
			"EB",
			"ZB",
			"YB"
		] : [
			"KiB",
			"MiB",
			"GiB",
			"TiB",
			"PiB",
			"EiB",
			"ZiB",
			"YiB"
		];
		var u = -1;
		do {
			bytes /= thresh;
			++u;
		} while (bytes >= thresh);
		return bytes.toFixed(1) + " " + units[u];
	}
	var loadBuffer = (url, ac, s, n = 0) => {
		const label = s ? `sound "${s}:${n}"` : "sample";
		url = url.replace("#", "%23");
		if (!loadCache[url]) {
			logger(`[sampler] load ${label}..`, "load-sample", { url });
			const timestamp = Date.now();
			loadCache[url] = fetch(url).then((res) => res.arrayBuffer()).then(async (res) => {
				const took = Date.now() - timestamp;
				const size = humanFileSize(res.byteLength);
				logger(`[sampler] load ${label}... done! loaded ${size} in ${took}ms`, "loaded-sample", { url });
				const decoded = await ac.decodeAudioData(res);
				bufferCache[url] = decoded;
				return decoded;
			});
		}
		return loadCache[url];
	};
	//#endregion
	//#region node_modules/superdough/superdoughoutput.mjs
	var hasChanged = (now, before) => now !== void 0 && now !== before;
	var getStereoNode = (ac) => new GainNode(ac, {
		gain: 1,
		channelCount: 2,
		channelCountMode: "explicit"
	});
	var Orbit = class {
		reverbNode;
		delayNode;
		output;
		summingNode;
		djfNode;
		audioContext;
		constructor(audioContext) {
			this.audioContext = audioContext;
			this.output = getStereoNode(audioContext);
			this.summingNode = getStereoNode(audioContext);
			this.summingNode.connect(this.output);
		}
		disconnect() {
			this.output.disconnect();
			this.summingNode.disconnect();
			this.delayNode?.disconnect();
			this.reverbNode?.disconnect();
		}
		getDjf(value, t = 0) {
			if (this.djfNode == null) {
				this.djfNode = getWorklet(this.audioContext, "djf-processor", { value });
				this.summingNode.disconnect();
				this.summingNode.connect(this.djfNode);
				this.djfNode.connect(this.output);
			}
			this.djfNode.parameters.get("value").setValueAtTime(value, t);
			return this.djfNode;
		}
		getDelay(delaytime = 0, feedback = .5, t) {
			if (feedback > .98) {}
			feedback = clamp(feedback, 0, .98);
			if (this.delayNode == null) {
				this.delayNode = this.audioContext.createFeedbackDelay(1, delaytime, feedback);
				this.delayNode.connect(this.summingNode);
				this.delayNode.start?.(t);
			}
			this.delayNode.delayTime.value !== delaytime && this.delayNode.delayTime.setValueAtTime(delaytime, t);
			this.delayNode.feedback.value !== feedback && this.delayNode.feedback.setValueAtTime(feedback, t);
			return this.delayNode;
		}
		getReverb(duration, fade, lp, dim, ir, irspeed, irbegin) {
			if (this.reverbNode == null) {
				this.reverbNode = this.audioContext.createReverb(duration, fade, lp, dim, ir, irspeed, irbegin);
				this.reverbNode.connect(this.summingNode);
			}
			if (hasChanged(duration, this.reverbNode.duration) || hasChanged(fade, this.reverbNode.fade) || hasChanged(lp, this.reverbNode.lp) || hasChanged(dim, this.reverbNode.dim) || hasChanged(irspeed, this.reverbNode.irspeed) || hasChanged(irbegin, this.reverbNode.irbegin) || this.reverbNode.ir !== ir) this.reverbNode.generate(duration, fade, lp, dim, ir, irspeed, irbegin);
			return this.reverbNode;
		}
		sendReverb(node, amount) {
			return effectSend(node, this.reverbNode, amount);
		}
		sendDelay(node, amount) {
			return effectSend(node, this.delayNode, amount);
		}
		duck(t, onsettime = 0, attacktime = .1, depth = 1) {
			const onset = onsettime;
			const attack = Math.max(attacktime, .002);
			const gainParam = this.output.gain;
			webAudioTimeout(this.audioContext, () => {
				const now = this.audioContext.currentTime;
				const currVal = gainParam.value;
				gainParam.cancelScheduledValues(now);
				gainParam.setValueAtTime(currVal, now);
				const t0 = Math.max(t, now);
				const duckedVal = clamp(1 - Math.sqrt(depth), .01, currVal);
				gainParam.exponentialRampToValueAtTime(duckedVal, t0 + onset);
				gainParam.exponentialRampToValueAtTime(1, t0 + onset + attack);
			}, 0, t - .01);
		}
		connectToOutput(node) {
			node.connect(this.summingNode);
		}
	};
	var SuperdoughOutput = class {
		channelMerger;
		destinationGain;
		constructor(audioContext) {
			this.audioContext = audioContext;
			this.initializeAudio();
		}
		initializeAudio() {
			const audioContext = this.audioContext;
			const maxChannelCount = audioContext.destination.maxChannelCount;
			this.audioContext.destination.channelCount = maxChannelCount;
			this.channelMerger = new ChannelMergerNode(audioContext, { numberOfInputs: audioContext.destination.channelCount });
			this.destinationGain = new GainNode(audioContext);
			this.channelMerger.connect(this.destinationGain);
			this.destinationGain.connect(audioContext.destination);
		}
		reset() {
			this.disconnect();
			this.initializeAudio();
		}
		disconnect() {
			this.channelMerger.disconnect();
			this.destinationGain.disconnect();
			this.destinationGain = null;
			this.channelMerger = null;
		}
		connectToDestination = (input, channels = [0, 1]) => {
			const stereoMix = new StereoPannerNode(this.audioContext);
			input.connect(stereoMix);
			const splitter = new ChannelSplitterNode(this.audioContext, { numberOfOutputs: stereoMix.channelCount });
			stereoMix.connect(splitter);
			channels.forEach((ch, i) => {
				splitter.connect(this.channelMerger, i % stereoMix.channelCount, ch % this.audioContext.destination.channelCount);
			});
		};
	};
	var SuperdoughAudioController = class {
		audioContext;
		output;
		nodes = {};
		buses = {};
		constructor(audioContext) {
			this.audioContext = audioContext;
			this.output = new SuperdoughOutput(audioContext);
		}
		reset() {
			Object.values(this.nodes).forEach((node) => {
				node.disconnect();
			});
			Object.values(this.buses).forEach((bus) => {
				bus.disconnect();
			});
			this.nodes = {};
			this.buses = {};
			this.output.reset();
		}
		duck(targetOrbits, t, onsettime = 0, attacktime = .1, depth = 1) {
			const targetArr = [targetOrbits].flat();
			const onsetArr = [onsettime].flat();
			const attackArr = [attacktime].flat();
			const depthArr = [depth].flat();
			targetArr.forEach((target, idx) => {
				const orbit = this.nodes[target];
				if (orbit == null) {
					errorLogger(/* @__PURE__ */ new Error(`duck target orbit ${target} does not exist`), "superdough");
					return;
				}
				const onset = onsetArr[idx] ?? onsetArr[0];
				const attack = Math.max(attackArr[idx] ?? attackArr[0], .002);
				const depth = depthArr[idx] ?? depthArr[0];
				orbit.duck(t, onset, attack, depth);
			});
		}
		getOrbit(orbitNum, channels) {
			if (this.nodes[orbitNum] == null) {
				this.nodes[orbitNum] = new Orbit(this.audioContext);
				this.output.connectToDestination(this.nodes[orbitNum].output, channels);
			}
			return this.nodes[orbitNum];
		}
		getBus(busNum) {
			if (this.buses[busNum] == null) this.buses[busNum] = getStereoNode(this.audioContext);
			return this.buses[busNum];
		}
	};
	Object.freeze({
		NONE: 0,
		ASYM: 1,
		MIRROR: 2,
		BENDP: 3,
		BENDM: 4,
		BENDMP: 5,
		SYNC: 6,
		QUANT: 7,
		FOLD: 8,
		PWM: 9,
		ORBIT: 10,
		SPIN: 11,
		CHAOS: 12,
		PRIMES: 13,
		BINARY: 14,
		BROWNIAN: 15,
		RECIPROCAL: 16,
		WORMHOLE: 17,
		LOGISTIC: 18,
		SIGMOID: 19,
		FRACTAL: 20,
		FLIP: 21
	});
	var seenKeys = /* @__PURE__ */ new Set();
	function resetSeenKeys() {
		seenKeys.clear();
	}
	var DEFAULT_AUDIO_DEVICE_NAME = "System Standard";
	var maxPolyphony = 128;
	/**
	* Set the max polyphony. If notes are ringing out via `release` then they will
	* start to die out in first-in-first-out order once the max polyphony has been hit
	*
	* @name setMaxPolyphony
	* @param {number} Max polyphony. Defaults to 128
	* @example
	* setMaxPolyphony(4)
	* n(irand(24).seg(8)).scale("C#3:minor").room(1).release(4).gain(0.5)
	*
	*/
	function setMaxPolyphony(polyphony) {
		maxPolyphony = parseInt(polyphony) ?? 128;
	}
	var multiChannelOrbits = false;
	function setMultiChannelOrbits(bool) {
		multiChannelOrbits = bool == true;
	}
	var soundMap = map();
	function registerSound(key, onTrigger, data = {}) {
		key = key.toLowerCase().replace(/\s+/g, "_");
		soundMap.setKey(key, {
			onTrigger,
			data
		});
	}
	var gainCurveFunc = (val) => val;
	function applyGainCurve(val) {
		return gainCurveFunc(val);
	}
	function getSound(s) {
		if (typeof s !== "string") {
			console.warn(`getSound: expected string got "${s}". fall back to triangle`);
			return soundMap.get().triangle;
		}
		return soundMap.get()[s.toLowerCase()];
	}
	var getAudioDevices = async () => {
		await navigator.mediaDevices.getUserMedia({ audio: true });
		let mediaDevices = await navigator.mediaDevices.enumerateDevices();
		mediaDevices = mediaDevices.filter((device) => device.kind === "audiooutput" && device.deviceId !== "default");
		const devicesMap = /* @__PURE__ */ new Map();
		devicesMap.set(DEFAULT_AUDIO_DEVICE_NAME, "");
		mediaDevices.forEach((device) => {
			devicesMap.set(device.label, device.deviceId);
		});
		return devicesMap;
	};
	var defaultDefaultValues = {
		s: "triangle",
		gain: .8,
		postgain: 1,
		density: ".03",
		channels: [1, 2],
		phaserdepth: .75,
		shapevol: 1,
		distortvol: 1,
		distorttype: 0,
		delay: 0,
		busgain: 1,
		byteBeatExpression: "0",
		delayfeedback: .5,
		delaysync: 3 / 16,
		orbit: 1,
		i: 1,
		velocity: 1,
		fft: 8,
		tremolodepth: 1,
		tremolophase: 0,
		release: .01
	};
	Object.freeze({ ...defaultDefaultValues });
	var defaultControls = new Map(Object.entries(defaultDefaultValues));
	function getDefaultValue(key) {
		return defaultControls.get(key);
	}
	var externalWorklets = [];
	var workletsLoading;
	function loadWorklets() {
		if (!workletsLoading) {
			const audioCtx = getAudioContext();
			const allWorkletURLs = externalWorklets.concat([_room_worklet_url_default]);
			workletsLoading = Promise.all(allWorkletURLs.map((workletURL) => audioCtx.audioWorklet.addModule(workletURL))).then(() => workletsLoading = void 0);
		}
		return workletsLoading;
	}
	async function initAudio(options = {}) {
		const { disableWorklets = false, maxPolyphony, audioDeviceName = DEFAULT_AUDIO_DEVICE_NAME, multiChannelOrbits = false } = options;
		setMaxPolyphony(maxPolyphony);
		setMultiChannelOrbits(multiChannelOrbits);
		resetSeenKeys();
		if (typeof window === "undefined") return;
		const audioCtx = getAudioContext();
		if (audioDeviceName != null && audioDeviceName != DEFAULT_AUDIO_DEVICE_NAME) try {
			const id = (await getAudioDevices()).get(audioDeviceName);
			const isValidID = (id ?? "").length > 0;
			if (audioCtx.sinkId !== id && isValidID) await audioCtx.setSinkId(id);
			logger(`[superdough] Audio Device set to ${audioDeviceName}, it might take a few seconds before audio plays on all output channels`);
		} catch {
			logger("[superdough] failed to set audio interface", "warning");
		}
		if (!audioCtx instanceof OfflineAudioContext) await audioCtx.resume();
		if (disableWorklets) {
			logger("[superdough]: AudioWorklets disabled with disableWorklets");
			return;
		}
		try {
			await loadWorklets();
			logger("[superdough] AudioWorklets loaded");
		} catch (err) {
			console.warn("could not load AudioWorklet effects", err);
		}
		logger("[superdough] ready");
	}
	var controller;
	function getSuperdoughAudioController() {
		if (controller == null) controller = new SuperdoughAudioController(getAudioContext());
		return controller;
	}
	function getPhaser(begin, end, frequency = 1, depth = .5, centerFrequency = 1e3, sweep = 2e3) {
		const ac = getAudioContext();
		const lfo = getLfo(ac, {
			frequency,
			depth: sweep * 2,
			begin,
			end
		});
		const numStages = 1;
		let fOffset = 282;
		const filterChain = [];
		for (let i = 0; i < numStages; i++) {
			const filter = getNodeFromPool("filter", () => ac.createBiquadFilter());
			filter.type = "notch";
			filter.gain.value = 1;
			filter.frequency.value = centerFrequency + fOffset;
			filter.Q.value = 2 - Math.min(Math.max(depth * 2, 0), 1.9);
			lfo.connect(filter.detune);
			fOffset += 282;
			filterChain.push(filter);
		}
		return {
			filterChain,
			lfo
		};
	}
	function getFilterType(ftype) {
		ftype = ftype ?? 0;
		const filterTypes = [
			"12db",
			"ladder",
			"24db"
		];
		return typeof ftype === "number" ? filterTypes[Math.floor(_mod$1(ftype, filterTypes.length))] : ftype;
	}
	var analysers = {};
	var analysersData = {};
	function getAnalyserById(id, fftSize = 1024, smoothingTimeConstant = .5) {
		if (!analysers[id] || analysers[id].context != getAudioContext()) {
			const analyserNode = getAudioContext().createAnalyser();
			analyserNode.fftSize = fftSize;
			analyserNode.smoothingTimeConstant = smoothingTimeConstant;
			analysers[id] = analyserNode;
			analysersData[id] = new Float32Array(analysers[id].frequencyBinCount);
		}
		if (analysers[id].fftSize !== fftSize) {
			analysers[id].fftSize = fftSize;
			analysersData[id] = new Float32Array(analysers[id].frequencyBinCount);
		}
		return analysers[id];
	}
	var activeSoundSources = /* @__PURE__ */ new Map();
	function mapChannelNumbers(channels) {
		return (Array.isArray(channels) ? channels : [channels]).map((ch) => ch - 1);
	}
	var Chain = class {
		constructor() {
			this.audioNodes = [];
			this.tails = [];
		}
		connect(...nodes) {
			nodes.forEach((node) => {
				this.tails.forEach((tail) => {
					tail.connect(node);
				});
			});
			this.tails = nodes;
			this.audioNodes.push(...nodes);
			return this;
		}
		connectOne(idx, node) {
			this.tails[idx].connect(node);
			this.tails[idx] = node;
			this.audioNodes.push(node);
			return this;
		}
		releaseNodes() {
			this.audioNodes.forEach((n) => isPoolable(n) ? releaseNodeToPool(n) : releaseAudioNode(n));
			this.audioNodes = [];
			this.tails = [];
		}
	};
	var superdough = async (value, t, hapDuration, cps = .5, cycle = .5) => {
		const nodes = { main: {} };
		const ac = getAudioContext();
		const audioController = getSuperdoughAudioController();
		let { stretch } = value;
		if (stretch != null) t = t - .04;
		if (typeof value !== "object") throw new Error(`expected hap.value to be an object, but got "${value}". Hint: append .note() or .s() to the end`, "error");
		value.duration = hapDuration;
		if (t < ac.currentTime) {
			console.warn(`[superdough]: cannot schedule sounds in the past (target: ${t.toFixed(2)}, now: ${ac.currentTime.toFixed(2)})`);
			return;
		}
		let { s = getDefaultValue("s"), bank, source, postgain = getDefaultValue("postgain"), duckorbit, duckonset, duckattack, duckdepth, djf, release = getDefaultValue("release"), dry, delay = getDefaultValue("delay"), delayfeedback = getDefaultValue("delayfeedback"), delaysync = getDefaultValue("delaysync"), delaytime, orbit = getDefaultValue("orbit"), bus, busgain = getDefaultValue("busgain"), room, roomfade, roomlp, roomdim, roomsize, ir, irspeed, irbegin, i = getDefaultValue("i"), analyze, fft = getDefaultValue("fft"), FX = [], FXrelease } = value;
		delaytime = delaytime ?? cycleToSeconds(delaysync, cps);
		const orbitChannels = mapChannelNumbers(multiChannelOrbits && orbit > 0 ? [orbit * 2 - 1, orbit * 2] : getDefaultValue("channels"));
		const channels = value.channels != null ? mapChannelNumbers(value.channels) : orbitChannels;
		const orbitBus = audioController.getOrbit(orbit, channels);
		if (duckorbit != null) audioController.duck(duckorbit, t, duckonset, duckattack, duckdepth);
		postgain = applyGainCurve(postgain);
		delay = applyGainCurve(delay);
		busgain = applyGainCurve(busgain);
		const end = t + hapDuration;
		const endWithRelease = end + Math.max(release, FXrelease ?? 0);
		const chainID = Math.round(Math.random() * 1e6);
		for (let i = 0; i <= activeSoundSources.size - maxPolyphony; i++) {
			const ch = activeSoundSources.entries().next();
			const source = ch.value[1].deref();
			const chainID = ch.value[0];
			const endTime = t + .25;
			source?.node?.gain?.linearRampToValueAtTime(0, endTime);
			source?.stop?.(endTime);
			activeSoundSources.delete(chainID);
		}
		if ([
			"-",
			"~",
			"_"
		].includes(s)) return;
		if (bank && s) {
			s = `${bank}_${s}`;
			value.s = s;
		}
		const chain = new Chain();
		let sourceNode;
		if (source) {
			sourceNode = source(t, value, hapDuration, cps);
			nodes.main["source"] = [sourceNode];
		} else if (getSound(s)) {
			const { onTrigger } = getSound(s);
			const onEnded = () => webAudioTimeout(ac, () => {
				chain.releaseNodes();
				activeSoundSources.delete(chainID);
			}, 0, endWithRelease);
			const soundHandle = await onTrigger(t, value, onEnded, cps);
			if (soundHandle) {
				sourceNode = soundHandle.node;
				activeSoundSources.set(chainID, new WeakRef(soundHandle));
				nodes.main = {
					...nodes.main,
					...soundHandle.nodes
				};
			}
		} else throw new Error(`sound ${s} not found! Is it loaded?`);
		if (!sourceNode) return;
		if (ac.currentTime > t) {
			logger("[webaudio] skip hap: still loading", ac.currentTime - t);
			return;
		}
		chain.connect(sourceNode);
		FX = [...FX, value];
		for (let [idx, fx] of Object.entries(FX)) {
			const key = idx == FX.length - 1 ? "main" : idx;
			nodes[key] ??= {};
			const fxNodes = nodes[key];
			let { gain = getDefaultValue("gain"), velocity = getDefaultValue("velocity"), shapevol = getDefaultValue("shapevol"), distorttype = getDefaultValue("distorttype"), distortvol = getDefaultValue("distortvol"), tremolodepth = getDefaultValue("tremolodepth"), phaserdepth = getDefaultValue("phaserdepth"), delay = getDefaultValue("delay"), delayfeedback = getDefaultValue("delayfeedback"), delaysync = getDefaultValue("delaysync"), delaytime, i = getDefaultValue("i") } = fx;
			gain = applyGainCurve(nanFallback(gain, 1));
			shapevol = applyGainCurve(shapevol);
			distortvol = applyGainCurve(distortvol);
			velocity = applyGainCurve(velocity);
			tremolodepth = applyGainCurve(tremolodepth);
			gain *= velocity;
			delaytime = delaytime ?? cycleToSeconds(delaysync, cps);
			if (fx.workletSrc !== void 0) {
				const workletNode = getWorklet(ac, "generic-processor", {}, { outputChannelCount: [2] });
				chain.connect(workletNode);
				const workletSrc = fx.workletSrc.replace(/\bpat\[(\d+)\]/g, (_, i) => fx.workletInputs[i]).replaceAll("sFreq", getFrequencyFromValue(value)).replaceAll("sGate", `cc('strudel-gate-${chainID}')`);
				const { src, ugens, registers } = compileKabel(workletSrc);
				workletNode.port.postMessage({
					src,
					schema: {
						ugens,
						registers
					},
					start: t,
					gateEnd: end,
					end: endWithRelease
				});
			}
			if (fx.stretch !== void 0) {
				const phaseVocoder = getWorklet(ac, "phase-vocoder-processor", { pitchFactor: fx.stretch });
				chain.connect(phaseVocoder);
				fxNodes["stretch"] = [phaseVocoder];
			}
			if (fx.transient !== void 0) {
				const transProcessor = getWorklet(ac, "transient-processor", {}, { processorOptions: {
					attack: fx.transient,
					sustain: fx.transsustain,
					begin: t,
					end: endWithRelease
				} });
				chain.connect(transProcessor);
				fxNodes["transient"] = transProcessor;
			}
			const initialGain = gainNode(gain);
			fxNodes["gain"] = [initialGain];
			chain.connect(initialGain);
			const ftype = getFilterType(value.ftype);
			const filt = (params) => createFilter(ac, t, end, params, cps, cycle);
			if (fx.cutoff !== void 0) {
				const lpParams = pickAndRename(fx, {
					frequency: "cutoff",
					q: "resonance",
					attack: "lpattack",
					decay: "lpdecay",
					sustain: "lpsustain",
					release: "lprelease",
					env: "lpenv",
					anchor: "fanchor",
					model: "ftype",
					drive: "drive",
					rate: "lprate",
					sync: "lpsync",
					depth: "lpdepth",
					depthfrequency: "lpdepthfrequency",
					shape: "lpshape",
					dcoffset: "lpdc",
					skew: "lpskew"
				});
				lpParams.type = "lowpass";
				const { filter: lpf1, lfo: lfo1 } = filt(lpParams);
				fxNodes["lpf"] = [lpf1];
				fxNodes["lpf_lfo"] = [lfo1];
				chain.connect(lpf1);
				lfo1 && chain.audioNodes.push(lfo1);
				if (ftype === "24db") {
					const { filter: lpf2, lfo: lfo2 } = filt(lpParams);
					fxNodes["lpf"].push(lpf2);
					fxNodes["lpf_lfo"].push(lfo2);
					chain.connect(lpf2);
					lfo2 && chain.audioNodes.push(lfo2);
				}
			}
			if (fx.hcutoff !== void 0) {
				const hpParams = pickAndRename(fx, {
					frequency: "hcutoff",
					q: "hresonance",
					attack: "hpattack",
					decay: "hpdecay",
					sustain: "hpsustain",
					release: "hprelease",
					env: "hpenv",
					anchor: "fanchor",
					model: "ftype",
					drive: "drive",
					rate: "hprate",
					sync: "hpsync",
					depth: "hpdepth",
					depthfrequency: "hpdepthfrequency",
					shape: "hpshape",
					dcoffset: "hpdc",
					skew: "hpskew"
				});
				hpParams.type = "highpass";
				const { filter: hpf1, lfo: lfo1 } = filt(hpParams);
				fxNodes["hpf"] = [hpf1];
				fxNodes["hpf_lfo"] = [lfo1];
				lfo1 && chain.audioNodes.push(lfo1);
				chain.connect(hpf1);
				if (ftype === "24db") {
					const { filter: hpf2, lfo: lfo2 } = filt(hpParams);
					fxNodes["hpf"].push(hpf2);
					fxNodes["hpf_lfo"].push(lfo2);
					chain.connect(hpf2);
					lfo2 && chain.audioNodes.push(lfo2);
				}
			}
			if (fx.bandf !== void 0) {
				const bpParams = pickAndRename(fx, {
					frequency: "bandf",
					q: "bandq",
					attack: "bpattack",
					decay: "bpdecay",
					sustain: "bpsustain",
					release: "bprelease",
					env: "bpenv",
					anchor: "fanchor",
					model: "ftype",
					drive: "drive",
					rate: "bprate",
					sync: "bpsync",
					depth: "bpdepth",
					depthfrequency: "bpdepthfrequency",
					shape: "bpshape",
					dcoffset: "bpdc",
					skew: "bpskew"
				});
				bpParams.type = "bandpass";
				const { filter: bpf1, lfo: lfo1 } = filt(bpParams);
				fxNodes["bpf"] = [bpf1];
				fxNodes["bpf_lfo"] = [lfo1];
				chain.connect(bpf1);
				lfo1 && chain.audioNodes.push(lfo1);
				if (ftype === "24db") {
					const { filter: bpf2, lfo: lfo2 } = filt(bpParams);
					fxNodes["bpf"].push(bpf2);
					fxNodes["bpf_lfo"].push(lfo2);
					chain.connect(bpf2);
					lfo2 && chain.audioNodes.push(lfo2);
				}
			}
			if (fx.vowel !== void 0) {
				const vowelNode = ac.createVowelFilter(fx.vowel);
				fxNodes["vowel"] = vowelNode.filters;
				chain.connect(vowelNode);
			}
			if (fx.coarse !== void 0) {
				const coarseNode = getWorklet(ac, "coarse-processor", { coarse: fx.coarse });
				fxNodes["coarse"] = [coarseNode];
				chain.connect(coarseNode);
			}
			if (fx.crush !== void 0) {
				const crushNode = getWorklet(ac, "crush-processor", { crush: fx.crush });
				fxNodes["crush"] = [crushNode];
				chain.connect(crushNode);
			}
			if (fx.shape !== void 0) {
				const shapeNode = getWorklet(ac, "shape-processor", {
					shape: fx.shape,
					postgain: shapevol
				});
				fxNodes["shape"] = [shapeNode];
				chain.connect(shapeNode);
			}
			if (fx.distort !== void 0) {
				const distortNode = getDistortion(fx.distort, distortvol, distorttype);
				fxNodes["distort"] = [distortNode];
				chain.connect(distortNode);
			}
			let tremolo = fx.tremolo;
			if (fx.tremolosync != null) tremolo = cps * fx.tremolosync;
			if (tremolo !== void 0) {
				const gain = Math.max(1 - tremolodepth, 0);
				const amGain = new GainNode(ac, { gain });
				const time = cycle / cps;
				const lfo = getLfo(ac, {
					skew: fx.tremoloskew ?? (fx.tremoloshape != null ? .5 : 1),
					frequency: tremolo,
					depth: tremolodepth,
					time,
					dcoffset: 0,
					shape: fx.tremoloshape,
					phaseoffset: fx.tremolophase,
					min: 0,
					max: 1,
					curve: 1.5,
					begin: t,
					end: endWithRelease
				});
				fxNodes["tremolo"] = [lfo];
				fxNodes["tremolo_gain"] = [amGain];
				lfo.connect(amGain.gain);
				chain.audioNodes.push(lfo);
				chain.connect(amGain);
			}
			if (fx.compressor !== void 0) {
				const compressorNode = getCompressor(ac, fx.compressor, fx.compressorRatio, fx.compressorKnee, fx.compressorAttack, fx.compressorRelease);
				fxNodes["compressor"] = [compressorNode];
				chain.connect(compressorNode);
			}
			if (fx.pan !== void 0) {
				const panner = ac.createStereoPanner();
				fxNodes["pan"] = [panner];
				panner.pan.value = 2 * fx.pan - 1;
				chain.connect(panner);
			}
			if (fx.phaserrate !== void 0 && phaserdepth > 0) {
				const { filterChain, lfo } = getPhaser(t, endWithRelease, fx.phaserrate, phaserdepth, fx.phasercenter, fx.phasersweep);
				fxNodes["phaser"] = [...filterChain];
				fxNodes["phaser_lfo"] = [lfo];
				filterChain.forEach((f) => chain.connect(f));
				chain.audioNodes.push(lfo);
			}
			if (key !== "main" && delay > 0 && delaytime > 0 && delayfeedback > 0) {
				const dry = gainNode(1);
				delayfeedback = clamp(delayfeedback, 0, .98);
				const delayNode = ac.createFeedbackDelay(1, delaytime, delayfeedback);
				const wetDelay = gainNode(delay);
				const dryDelay = gainNode(fx.dry ?? 1);
				const sum = new GainNode(ac, {
					gain: 1,
					channelCount: 2,
					channelCountMode: "explicit"
				});
				chain.connect(dry).connect(dryDelay, delayNode).connectOne(1, wetDelay).connect(sum);
				chain.audioNodes.push(delayNode.feedbackGain, delayNode.delayGain);
				fxNodes["delay"] = [delayNode];
				fxNodes["delay_mix"] = [wetDelay];
			}
			if (key !== "main" && fx.room > 0) {
				let roomIR;
				if (fx.ir !== void 0) {
					let url;
					let sample = getSound(fx.ir);
					if (Array.isArray(sample)) url = sample.data.samples[fx.i % sample.data.samples.length];
					else if (typeof sample === "object") url = Object.values(sample.data.samples).flat()[i % Object.values(sample.data.samples).length];
					roomIR = await loadBuffer(url, ac, fx.ir, 0);
				}
				const dry = gainNode(1);
				const reverbNode = ac.createReverb(fx.roomsize, fx.roomfade, fx.roomlp, fx.roomdim, roomIR, fx.irspeed, fx.irbegin);
				const wetReverb = gainNode(fx.room);
				const dryReverb = gainNode(fx.dry ?? 1);
				const sum = new GainNode(ac, {
					gain: 1,
					channelCount: 2,
					channelCountMode: "explicit"
				});
				chain.connect(dry).connect(dryReverb, reverbNode).connectOne(1, wetReverb).connect(sum);
				fxNodes["room"] = [reverbNode];
				fxNodes["room_mix"] = [wetReverb];
			}
		}
		if (FXrelease !== void 0 && FXrelease > release) {
			const releaseNode = gainNode(1);
			releaseNode.gain.setValueAtTime(1, end + release);
			releaseNode.gain.linearRampToValueAtTime(0, endWithRelease);
			chain.connect(releaseNode);
		}
		const post = new GainNode(ac, { gain: postgain });
		nodes.main["post"] = [post];
		chain.connect(post);
		if (delay > 0 && delaytime > 0 && delayfeedback > 0) {
			const delayNode = orbitBus.getDelay(delaytime, delayfeedback, t);
			nodes.main["delay"] = [delayNode];
			const delaySend = orbitBus.sendDelay(post, delay);
			nodes.main["delay_mix"] = [delaySend];
			chain.audioNodes.push(delaySend);
		}
		if (room > 0) {
			let roomIR;
			if (ir !== void 0) {
				let url;
				let sample = getSound(ir);
				if (Array.isArray(sample)) url = sample.data.samples[i % sample.data.samples.length];
				else if (typeof sample === "object") url = Object.values(sample.data.samples).flat()[i % Object.values(sample.data.samples).length];
				roomIR = await loadBuffer(url, ac, ir, 0);
			}
			const roomNode = orbitBus.getReverb(roomsize, roomfade, roomlp, roomdim, roomIR, irspeed, irbegin);
			nodes.main["room"] = [roomNode];
			const reverbSend = orbitBus.sendReverb(post, room);
			nodes.main["room_mix"] = [reverbSend];
			chain.audioNodes.push(reverbSend);
		}
		if (bus != null) {
			const busSend = effectSend(post, audioController.getBus(bus), busgain);
			chain.audioNodes.push(busSend);
		}
		if (djf != null) {
			const djfNode = orbitBus.getDjf(djf, t);
			nodes.main["djf"] = [djfNode];
		}
		if (analyze && !(ac instanceof OfflineAudioContext)) {
			const analyserSend = effectSend(post, getAnalyserById(analyze, 2 ** (fft + 5)), 1);
			chain.audioNodes.push(analyserSend);
		}
		if (dry != null) {
			dry = applyGainCurve(dry);
			const dryGain = new GainNode(ac, { gain: dry });
			chain.connect(dryGain);
			orbitBus.connectToOutput(dryGain);
		} else orbitBus.connectToOutput(post);
		FX.forEach((fx, idx) => {
			const key = idx === FX.length - 1 ? "main" : idx;
			if (fx.lfo) for (const id of fx.lfo.__ids) {
				const params = fx.lfo[id];
				params.fxi ??= key;
				const lfo = connectLFO(id, {
					...params,
					cps,
					cycle,
					begin: t,
					end: endWithRelease
				}, nodes);
				lfo && chain.audioNodes.push(lfo);
			}
			if (fx.env) for (const id of fx.env.__ids) {
				const params = fx.env[id];
				params.fxi ??= key;
				const env = connectEnvelope(id, {
					...params,
					begin: t,
					end: endWithRelease
				}, nodes);
				env && chain.audioNodes.push(env);
			}
			if (fx.bmod) for (const id of fx.bmod.__ids) {
				const params = fx.bmod[id];
				params.fxi ??= key;
				const { toCleanup } = connectBusModulator({
					...params,
					begin: t,
					end: endWithRelease
				}, nodes, controller);
				chain.audioNodes.push(...toCleanup);
			}
		});
	};
	//#endregion
	//#region node_modules/superdough/synth.mjs
	var waveforms = [
		"triangle",
		"square",
		"sawtooth",
		"sine",
		"user",
		"one"
	];
	var waveformAliases = [
		["tri", "triangle"],
		["sqr", "square"],
		["saw", "sawtooth"],
		["sin", "sine"]
	];
	function makeSaturationCurve(amount, n_samples) {
		const k = typeof amount === "number" ? amount : 50;
		const curve = new Float32Array(n_samples);
		for (let i = 0; i < n_samples; i++) {
			const x = i * 2 / n_samples - 1;
			curve[i] = Math.tanh(x * k);
		}
		return curve;
	}
	function registerSynthSounds() {
		[...waveforms].forEach((s) => {
			registerSound(s, (t, value, onended) => {
				const [attack, decay, sustain, release] = getADSRValues([
					value.attack,
					value.decay,
					value.sustain,
					value.release
				], "linear", [
					.001,
					.05,
					.6,
					.01
				]);
				const g = gainNode(.3);
				const { node: o, nodes, stop, triggerRelease } = getOscillator(s, t, value, () => {
					releaseAudioNode(g);
					onended();
				});
				const { duration } = value;
				const envGain = gainNode(1);
				const node = o.connect(g).connect(envGain);
				const holdEnd = t + duration;
				getParamADSR(node.gain, attack, decay, sustain, release, 0, 1, t, holdEnd, "linear");
				const envEnd = holdEnd + release + .01;
				triggerRelease?.(envEnd);
				stop(envEnd);
				return {
					node,
					nodes,
					stop: (endTime) => {
						stop(endTime);
					}
				};
			}, {
				type: "synth",
				prebake: true
			});
		});
		registerSound("sbd", (t, value, onended) => {
			const { duration, decay = .5, pdecay = .5, penv = 36, clip } = value;
			const ctx = getAudioContext();
			const attackhold = .02;
			const noiselvl = 1.2;
			const noisedecay = .025;
			const mixGain = 1;
			const o = ctx.createOscillator();
			o.type = "triangle";
			o.frequency.value = getFrequencyFromValue(value, 29);
			o.detune.setValueAtTime(penv * 100, 0);
			o.detune.setValueAtTime(penv * 100, t);
			o.detune.exponentialRampToValueAtTime(.001, t + pdecay);
			const g = gainNode(1);
			g.gain.setValueAtTime(1, t + attackhold);
			g.gain.exponentialRampToValueAtTime(.001, t + attackhold + decay);
			o.start(t);
			const noise = getNoiseOscillator("brown", t, 2);
			const noiseGain = gainNode(1);
			noiseGain.gain.setValueAtTime(noiselvl, t);
			noiseGain.gain.exponentialRampToValueAtTime(.001, t + noisedecay);
			const sat = new WaveShaperNode(ctx);
			sat.curve = makeSaturationCurve(2, ctx.sampleRate);
			const mix = gainNode(mixGain);
			onceEnded(o, () => {
				releaseAudioNode(o);
				releaseAudioNode(g);
				releaseAudioNode(sat);
				releaseAudioNode(noise.node);
				releaseAudioNode(noiseGain);
				releaseAudioNode(mix);
				onended();
			});
			const node = o.connect(sat).connect(g).connect(mix);
			noise.node.connect(noiseGain).connect(mix);
			let end = t + decay + .01;
			if (clip != null) end = Math.min(t + clip * duration, end);
			mix.gain.setValueAtTime(mixGain, end - .01);
			mix.gain.linearRampToValueAtTime(0, end);
			o.stop(end);
			noise.stop(end);
			return {
				node,
				nodes: { source: [o] },
				stop: (endTime) => {
					o.stop(endTime);
				}
			};
		}, {
			type: "synth",
			prebake: true
		});
		registerSound("supersaw", (begin, value, onended) => {
			const ac = getAudioContext();
			let { duration, n, unison = 5, spread = .6, detune } = value;
			detune = detune ?? n ?? .18;
			const frequency = getFrequencyFromValue(value);
			const [attack, decay, sustain, release] = getADSRValues([
				value.attack,
				value.decay,
				value.sustain,
				value.release
			], "linear", [
				.001,
				.05,
				.6,
				.01
			]);
			const holdend = begin + duration;
			const end = holdend + release + .01;
			const voices = clamp(unison, 1, 100);
			let panspread = voices > 1 ? clamp(spread, 0, 1) : 0;
			const params = {
				frequency,
				begin,
				end,
				freqspread: detune,
				voices,
				panspread
			};
			const factory = () => new AudioWorkletNode(ac, "supersaw-oscillator", { outputChannelCount: [2] });
			const o = getNodeFromPool("supersaw", factory);
			Object.entries(params).forEach(([key, value]) => {
				const param = o.parameters.get(key);
				param.value = value !== void 0 ? value : param.defaultValue;
			});
			o.port.postMessage({ type: "initialize" });
			const gainAdjustment = 1 / Math.sqrt(voices);
			getPitchEnvelope(o.parameters.get("detune"), value, begin, holdend);
			const vibratoHandle = getVibratoOscillator(o.parameters.get("detune"), value, begin);
			const fmHandle = applyFM(o.parameters.get("frequency"), value, begin);
			let envGain = gainNode(1);
			envGain = o.connect(envGain);
			getParamADSR(envGain.gain, attack, decay, sustain, release, 0, .3 * gainAdjustment, begin, holdend, "linear");
			let timeoutNode = webAudioTimeout(ac, () => {
				releaseNodeToPool(o);
				onended();
				fmHandle?.stop();
				vibratoHandle?.stop();
			}, begin, end);
			return {
				node: envGain,
				nodes: {
					source: [o],
					...fmHandle?.nodes,
					...vibratoHandle?.nodes
				},
				stop: (time) => {
					timeoutNode.stop(time);
				}
			};
		}, {
			prebake: true,
			type: "synth"
		});
		registerSound("bytebeat", (begin, value, onended) => {
			const defaultBeats = [
				"(t%255 >= t/255%255)*255",
				"(t*(t*8%60 <= 300)|(-t)*(t*4%512 < 256))+t/400",
				"t",
				"t*(t >> 10^t)",
				"t&128",
				"t&t>>8",
				"((t%255+t%128+t%64+t%32+t%16+t%127.8+t%64.8+t%32.8+t%16.8)/3)",
				"((t%64+t%63.8+t%64.15+t%64.35+t%63.5)/1.25)",
				"(t&(t>>7)-t)",
				"(sin(t*PI/128)*127+127)",
				"((t^t/2+t+64*(sin((t*PI/64)+(t*PI/32768))+64))%128*2)",
				"((t^t/2+t+64*(cos >> 0))%127.85*2)",
				"((t^t/2+t+64)%128*2)",
				"(((t * .25)^(t * .25)/100+(t * .25))%128)*2",
				"((t^t/2+t+64)%7 * 24)"
			];
			const { n = 0 } = value;
			const frequency = getFrequencyFromValue(value);
			const { byteBeatExpression = defaultBeats[n % defaultBeats.length], byteBeatStartTime } = value;
			const ac = getAudioContext();
			let { duration } = value;
			const [attack, decay, sustain, release] = getADSRValues([
				value.attack,
				value.decay,
				value.sustain,
				value.release
			], "linear", [
				.001,
				.05,
				.6,
				.01
			]);
			const holdend = begin + duration;
			const end = holdend + release + .01;
			let o = getWorklet(ac, "byte-beat-processor", {
				frequency,
				begin,
				end
			}, { outputChannelCount: [2] });
			o.port.postMessage({
				codeText: byteBeatExpression,
				byteBeatStartTime,
				frequency
			});
			let envGain = gainNode(1);
			envGain = o.connect(envGain);
			getParamADSR(envGain.gain, attack, decay, sustain, release, 0, 1, begin, holdend, "linear");
			let timeoutNode = webAudioTimeout(ac, () => {
				releaseAudioNode(o);
				onended();
			}, begin, end);
			return {
				node: envGain,
				source: o,
				stop: (time) => {
					timeoutNode.stop(time);
				}
			};
		}, {
			prebake: true,
			type: "synth"
		});
		registerSound("pulse", (begin, value, onended) => {
			const ac = getAudioContext();
			let { pwrate, pwsweep } = value;
			if (pwsweep == null) {
				if (pwrate != null) pwsweep = .3;
				else pwsweep = 0;
			}
			if (pwrate == null && pwsweep != null) pwrate = 1;
			let { duration, pw: pulsewidth = .5 } = value;
			const frequency = getFrequencyFromValue(value);
			const [attack, decay, sustain, release] = getADSRValues([
				value.attack,
				value.decay,
				value.sustain,
				value.release
			], "linear", [
				.001,
				.05,
				.6,
				.01
			]);
			const holdend = begin + duration;
			const end = holdend + release + .01;
			let o = getWorklet(ac, "pulse-oscillator", {
				frequency,
				begin,
				end,
				pulsewidth
			}, { outputChannelCount: [2] });
			getPitchEnvelope(o.parameters.get("detune"), value, begin, holdend);
			const vibratoHandle = getVibratoOscillator(o.parameters.get("detune"), value, begin);
			const fmHandle = applyFM(o.parameters.get("frequency"), value, begin);
			let envGain = gainNode(1);
			envGain = o.connect(envGain);
			getParamADSR(envGain.gain, attack, decay, sustain, release, 0, 1, begin, holdend, "linear");
			let pw_lfo;
			if (pwsweep != 0) {
				pw_lfo = getLfo(ac, {
					frequency: pwrate,
					depth: pwsweep,
					begin,
					end
				});
				pw_lfo.connect(o.parameters.get("pulsewidth"));
			}
			let timeoutNode = webAudioTimeout(ac, () => {
				releaseAudioNode(o);
				releaseAudioNode(pw_lfo);
				onended();
				fmHandle?.stop();
				vibratoHandle?.stop();
			}, begin, end);
			return {
				node: envGain,
				nodes: {
					source: [o],
					pw_lfo: [pw_lfo],
					...fmHandle?.nodes,
					...vibratoHandle?.nodes
				},
				stop: (time) => {
					timeoutNode.stop(time);
				}
			};
		}, {
			prebake: true,
			type: "synth"
		});
		registerSound("bus", (begin, value, onended) => {
			const ac = getAudioContext();
			const [attack, decay, sustain, release] = getADSRValues([
				value.attack,
				value.decay,
				value.sustain,
				value.release
			], "linear", [
				.001,
				.05,
				1,
				.01
			]);
			const holdend = begin + value.duration;
			const end = holdend + release + .01;
			const bus = getSuperdoughAudioController().getBus(value.n ?? 0);
			const envGain = bus.connect(gainNode(0));
			getParamADSR(envGain.gain, attack, decay, sustain, release, 0, 1, begin, holdend, "linear");
			const timeoutNode = webAudioTimeout(ac, () => {
				bus.disconnect(envGain);
				onended();
			}, begin, end);
			return {
				node: envGain,
				nodes: { source: [bus] },
				stop: (time) => {
					timeoutNode.stop(time);
				}
			};
		}, {
			prebake: true,
			type: "input"
		});
		[...noises].forEach((s) => {
			registerSound(s, (t, value, onended) => {
				const [attack, decay, sustain, release] = getADSRValues([
					value.attack,
					value.decay,
					value.sustain,
					value.release
				], "linear", [
					.001,
					.05,
					.6,
					.01
				]);
				let sound;
				let { density } = value;
				sound = getNoiseOscillator(s, t, density);
				let { node: o, stop, triggerRelease } = sound;
				const g = gainNode(.3);
				const { duration } = value;
				onceEnded(o, () => {
					releaseAudioNode(o);
					releaseAudioNode(g);
					onended();
				});
				const envGain = gainNode(1);
				let node = o.connect(g).connect(envGain);
				const holdEnd = t + duration;
				getParamADSR(node.gain, attack, decay, sustain, release, 0, 1, t, holdEnd, "linear");
				const envEnd = holdEnd + release + .01;
				triggerRelease?.(envEnd);
				stop(envEnd);
				return {
					node,
					nodes: { source: [o] },
					stop: (endTime) => {
						stop(endTime);
					}
				};
			}, {
				type: "synth",
				prebake: true
			});
		});
		waveformAliases.forEach(([alias, actual]) => soundMap.set({
			...soundMap.get(),
			[alias]: soundMap.get()[actual]
		}));
	}
	var PI2 = 2 * Math.PI;
	function waveformN(partials, phases, type) {
		partials = typeof partials === "object" ? partials : new Float32Array(partials).fill(1);
		const len = partials.length;
		const real = new Float32Array(len + 1);
		const imag = new Float32Array(len + 1);
		const ac = getAudioContext();
		const osc = ac.createOscillator();
		const terms = {
			sawtooth: (n) => [0, -1 / n],
			square: (n) => [0, n % 2 === 0 ? 0 : 1 / n],
			triangle: (n) => [n % 2 === 0 ? 0 : 1 / (n * n), 0],
			user: (_n) => [0, 1]
		};
		if (!terms[type]) throw new Error(`unknown wave type ${type}`);
		for (let n = 0; n < len; n++) {
			const mag = partials[n];
			const [r, i] = terms[type](n + 1);
			const phase = phases?.[n] ?? 0;
			let R = r * mag;
			let I = i * mag;
			if (phase !== 0) {
				const c = Math.cos(PI2 * phase);
				const s = Math.sin(PI2 * phase);
				R = c * R - s * I;
				I = s * R + c * I;
			}
			real[n + 1] = R;
			imag[n + 1] = I;
		}
		const wave = ac.createPeriodicWave(real, imag);
		osc.setPeriodicWave(wave);
		return osc;
	}
	function getOscillator(s, t, value, onended) {
		const { duration, noise = 0 } = value;
		const partials = value.partials ?? value.n;
		let o;
		if (s === "user" && !partials) {
			logger(`[superdough] Synth 'user' was selected, but partials not specified. Defaulting to triangle. Use pat.partials to setup custom waveform`);
			s = "triangle";
		}
		s = s === "user" && !partials ? "triangle" : s;
		if (s === "one") {
			o = new ConstantSourceNode(getAudioContext(), { offset: 1 });
			o.start(t);
			return {
				node: o,
				nodes: { source: o },
				stop: (time) => o?.stop(time)
			};
		} else if (!partials || partials?.length === 0 || s === "sine") {
			o = getAudioContext().createOscillator();
			o.type = s || "triangle";
		} else o = waveformN(partials, value.phases, s);
		o.frequency.value = getFrequencyFromValue(value);
		const vibratoHandle = getVibratoOscillator(o.detune, value, t);
		getPitchEnvelope(o.detune, value, t, t + duration);
		const fmHandle = applyFM(o.frequency, value, t);
		let noiseMix;
		if (noise) noiseMix = getNoiseMix(o, noise, t);
		onceEnded(o, () => {
			noiseMix?.teardown();
			releaseAudioNode(o);
			releaseAudioNode(noiseMix?.node);
			onended();
		});
		o.start(t);
		return {
			node: noiseMix?.node || o,
			nodes: {
				source: [o],
				...vibratoHandle?.nodes,
				...fmHandle?.nodes
			},
			stop: (time) => {
				fmHandle.stop(time);
				vibratoHandle?.stop(time);
				noiseMix?.stop(time);
				o.stop(time);
			},
			triggerRelease: (time) => {}
		};
	}
	//#endregion
	//#region node_modules/superdough/dspworklet.mjs
	var worklet;
	var stop = () => {
		if (worklet) {
			worklet?.stop();
			worklet?.node?.disconnect();
		}
	};
	if (typeof window !== "undefined") window.addEventListener("message", (e) => {
		if (e.data === "strudel-stop") stop();
		else if (e.data?.dough) worklet?.node.port.postMessage(e.data);
	});
	//#endregion
	exports.getAudioContext = getAudioContext;
	exports.getSuperdoughAudioController = getSuperdoughAudioController;
	exports.initAudio = initAudio;
	exports.registerSynthSounds = registerSynthSounds;
	exports.superdough = superdough;
	return exports;
})({});
