/** Intenções por efeito, sem guardar índices ou supor que escolher é resolver. */
export class BotIntentStack {
    intents = [];
    begin(code, route, step, description) {
        this.intents.push({ code, description: description !== undefined && description >= 0x100000n ? description : undefined,
            route: route?.id ?? null, step: step?.id ?? null });
        if (this.intents.length > 32)
            this.intents.shift();
    }
    current(effect) {
        if (!effect)
            return this.intents.at(-1) ?? null;
        if (effect.negated)
            return null;
        return this.intents.findLast((intent) => intent.code === effect.code
            && (intent.description === undefined || intent.description === effect.description)) ?? null;
    }
    clear() { this.intents = []; }
    invalidate(code) { this.intents = this.intents.filter((intent) => intent.code !== code); }
}
