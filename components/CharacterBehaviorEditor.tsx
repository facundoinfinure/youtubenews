/**
 * Character Behavior Editor Component
 * 
 * Advanced UI for configuring character behavior instructions
 * Used in Admin Dashboard for fine-tuning how characters speak and interact
 */

import React, { useState } from 'react';
import { CharacterProfile, CharacterBehavior } from '../types';
import { getDefaultBehavior } from '../constants';

interface CharacterBehaviorEditorProps {
  character: CharacterProfile;
  onSave: (behavior: CharacterBehavior) => void;
  onCancel?: () => void;
}

export const CharacterBehaviorEditor: React.FC<CharacterBehaviorEditorProps> = ({
  character,
  onSave,
  onCancel
}) => {
  const [behavior, setBehavior] = useState<CharacterBehavior>(
    character.behaviorInstructions || getDefaultBehavior()
  );

  const updateBehavior = <K extends keyof CharacterBehavior>(
    key: K,
    value: CharacterBehavior[K]
  ) => {
    setBehavior(prev => ({ ...prev, [key]: value }));
  };

  const updateNested = <
    K extends keyof CharacterBehavior,
    NK extends keyof CharacterBehavior[K]
  >(
    key: K,
    nestedKey: NK,
    value: CharacterBehavior[K][NK]
  ) => {
    setBehavior(prev => {
      const currentValue = prev[key];
      if (currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
        return {
          ...prev,
          [key]: { ...(currentValue as Record<string, any>), [nestedKey]: value } as CharacterBehavior[K]
        };
      }
      return prev;
    });
  };

  return (
    <div className="space-y-6 p-6 bg-white/[0.02] rounded-xl border border-white/10">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-white">
          Comportamiento de {character.name}
        </h3>
        <div className="flex gap-2">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              Cancelar
            </button>
          )}
          <button
            onClick={() => onSave(behavior)}
            className="px-4 py-2 rounded-lg bg-accent-500 hover:bg-accent-600 text-white font-medium transition-colors"
          >
            Guardar Comportamiento
          </button>
        </div>
      </div>

      {/* Estilo de Habla */}
      <Section title="Estilo de Habla">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Longitud de Oraciones
            </label>
            <select
              value={behavior.speakingStyle.sentenceLength}
              onChange={(e) => updateNested('speakingStyle', 'sentenceLength', e.target.value as any)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="short">Cortas (5-10 palabras)</option>
              <option value="medium">Medianas (10-15 palabras)</option>
              <option value="long">Largas (15+ palabras)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Formalidad
            </label>
            <select
              value={behavior.speakingStyle.formality}
              onChange={(e) => updateNested('speakingStyle', 'formality', e.target.value as any)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="casual">Casual</option>
              <option value="professional">Profesional</option>
              <option value="mixed">Mixto</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Nivel de Energía
            </label>
            <select
              value={behavior.speakingStyle.energy}
              onChange={(e) => updateNested('speakingStyle', 'energy', e.target.value as any)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="low">Bajo</option>
              <option value="medium">Medio</option>
              <option value="high">Alto</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="useContractions"
              checked={behavior.speakingStyle.useContractions}
              onChange={(e) => updateNested('speakingStyle', 'useContractions', e.target.checked)}
              className="w-5 h-5 rounded bg-white/5 border-white/10 text-accent-500 focus:ring-accent-500"
            />
            <label htmlFor="useContractions" className="text-sm text-white/80">
              Usar Contracciones
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="useSlang"
              checked={behavior.speakingStyle.useSlang}
              onChange={(e) => updateNested('speakingStyle', 'useSlang', e.target.checked)}
              className="w-5 h-5 rounded bg-white/5 border-white/10 text-accent-500 focus:ring-accent-500"
            />
            <label htmlFor="useSlang" className="text-sm text-white/80">
              Usar Jerga/Slang
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Uso de Números
            </label>
            <select
              value={behavior.speakingStyle.useNumbers}
              onChange={(e) => updateNested('speakingStyle', 'useNumbers', e.target.value as any)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="always">Siempre</option>
              <option value="often">Frecuentemente</option>
              <option value="sometimes">A veces</option>
              <option value="rarely">Raramente</option>
            </select>
          </div>
        </div>
      </Section>

      {/* Tono */}
      <Section title="Tono y Actitud">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Tono por Defecto
            </label>
            <select
              value={behavior.tone.default}
              onChange={(e) => updateNested('tone', 'default', e.target.value as any)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="sarcastic">Sarcástico</option>
              <option value="serious">Serio</option>
              <option value="playful">Juguetón</option>
              <option value="analytical">Analítico</option>
              <option value="empathetic">Empático</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Tono para Buenas Noticias
            </label>
            <select
              value={behavior.tone.variations.forGoodNews}
              onChange={(e) => updateNested('tone', 'variations', {
                ...behavior.tone.variations,
                forGoodNews: e.target.value as any
              })}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="sarcastic">Sarcástico</option>
              <option value="serious">Serio</option>
              <option value="playful">Juguetón</option>
              <option value="analytical">Analítico</option>
              <option value="empathetic">Empático</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Tono para Malas Noticias
            </label>
            <select
              value={behavior.tone.variations.forBadNews}
              onChange={(e) => updateNested('tone', 'variations', {
                ...behavior.tone.variations,
                forBadNews: e.target.value as any
              })}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="sarcastic">Sarcástico</option>
              <option value="serious">Serio</option>
              <option value="playful">Juguetón</option>
              <option value="analytical">Analítico</option>
              <option value="empathetic">Empático</option>
            </select>
          </div>
        </div>
      </Section>

      {/* Opiniones y Perspectiva */}
      <Section title="Opiniones y Perspectiva">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Perspectiva sobre Mercados
            </label>
            <select
              value={behavior.viewpoints.onMarkets}
              onChange={(e) => updateNested('viewpoints', 'onMarkets', e.target.value as any)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="bullish">Alcista (Optimista)</option>
              <option value="bearish">Bajista (Pesimista)</option>
              <option value="neutral">Neutral</option>
              <option value="skeptical">Escéptico</option>
              <option value="optimistic">Optimista</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Perspectiva sobre Empresas
            </label>
            <select
              value={behavior.viewpoints.onCompanies}
              onChange={(e) => updateNested('viewpoints', 'onCompanies', e.target.value as any)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="pro-business">Pro-Empresas</option>
              <option value="critical">Crítico</option>
              <option value="neutral">Neutral</option>
              <option value="skeptical">Escéptico</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Perspectiva sobre Regulación
            </label>
            <select
              value={behavior.viewpoints.onRegulation}
              onChange={(e) => updateNested('viewpoints', 'onRegulation', e.target.value as any)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="pro-regulation">Pro-Regulación</option>
              <option value="anti-regulation">Anti-Regulación</option>
              <option value="neutral">Neutral</option>
              <option value="pragmatic">Pragmático</option>
            </select>
          </div>
        </div>
      </Section>

      {/* Frases Características */}
      <Section title="Frases y Expresiones">
        <div className="space-y-4">
          <TextArrayInput
            label="Catchphrases (Frases Características)"
            value={behavior.catchphrases}
            onChange={(v) => updateBehavior('catchphrases', v)}
            placeholder="Ej: 'That's bananas!', 'No way!'"
            helpText="Frases que el personaje usa frecuentemente"
          />

          <TextArrayInput
            label="Expresiones de Acuerdo"
            value={behavior.expressions.agreement}
            onChange={(v) => updateNested('expressions', 'agreement', v)}
            placeholder="Ej: 'Exactly!', 'Totally', 'I agree'"
          />

          <TextArrayInput
            label="Expresiones de Desacuerdo"
            value={behavior.expressions.disagreement}
            onChange={(v) => updateNested('expressions', 'disagreement', v)}
            placeholder="Ej: 'Wait, hold on', 'I'm not so sure'"
          />

          <TextArrayInput
            label="Expresiones de Sorpresa"
            value={behavior.expressions.surprise}
            onChange={(v) => updateNested('expressions', 'surprise', v)}
            placeholder="Ej: 'Wow', 'No way', 'That's insane'"
          />
        </div>
      </Section>

      {/* Estilo de Argumentación */}
      <Section title="Estilo de Argumentación">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Estilo
            </label>
            <select
              value={behavior.argumentation.style}
              onChange={(e) => updateNested('argumentation', 'style', e.target.value as any)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="direct">Directo</option>
              <option value="indirect">Indirecto</option>
              <option value="questioning">Hace Preguntas</option>
              <option value="assertive">Asertivo</option>
              <option value="diplomatic">Diplomático</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="useExamples"
              checked={behavior.argumentation.useExamples}
              onChange={(e) => updateNested('argumentation', 'useExamples', e.target.checked)}
              className="w-5 h-5 rounded bg-white/5 border-white/10 text-accent-500 focus:ring-accent-500"
            />
            <label htmlFor="useExamples" className="text-sm text-white/80">
              Usar Ejemplos
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="useAnalogies"
              checked={behavior.argumentation.useAnalogies}
              onChange={(e) => updateNested('argumentation', 'useAnalogies', e.target.checked)}
              className="w-5 h-5 rounded bg-white/5 border-white/10 text-accent-500 focus:ring-accent-500"
            />
            <label htmlFor="useAnalogies" className="text-sm text-white/80">
              Usar Analogías
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Uso de Datos
            </label>
            <select
              value={behavior.argumentation.useData}
              onChange={(e) => updateNested('argumentation', 'useData', e.target.value as any)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="always">Siempre</option>
              <option value="often">Frecuentemente</option>
              <option value="sometimes">A veces</option>
              <option value="rarely">Raramente</option>
            </select>
          </div>
        </div>
      </Section>

      {/* Interacción con Otro Host */}
      <Section title="Interacción con el Otro Host">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Frecuencia de Interrupciones
            </label>
            <select
              value={behavior.interaction.interruptFrequency}
              onChange={(e) => updateNested('interaction', 'interruptFrequency', e.target.value as any)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="never">Nunca</option>
              <option value="rarely">Raramente</option>
              <option value="sometimes">A veces</option>
              <option value="often">Frecuentemente</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="buildOnOthers"
              checked={behavior.interaction.buildOnOthers}
              onChange={(e) => updateNested('interaction', 'buildOnOthers', e.target.checked)}
              className="w-5 h-5 rounded bg-white/5 border-white/10 text-accent-500 focus:ring-accent-500"
            />
            <label htmlFor="buildOnOthers" className="text-sm text-white/80">
              Construye sobre lo que dice el otro
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="createContrast"
              checked={behavior.interaction.createContrast}
              onChange={(e) => updateNested('interaction', 'createContrast', e.target.checked)}
              className="w-5 h-5 rounded bg-white/5 border-white/10 text-accent-500 focus:ring-accent-500"
            />
            <label htmlFor="createContrast" className="text-sm text-white/80">
              Busca crear contraste
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Nivel de Acuerdo
            </label>
            <select
              value={behavior.interaction.agreementLevel}
              onChange={(e) => updateNested('interaction', 'agreementLevel', e.target.value as any)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="always">Siempre</option>
              <option value="often">Frecuentemente</option>
              <option value="sometimes">A veces</option>
              <option value="rarely">Raramente</option>
              <option value="never">Nunca</option>
            </select>
          </div>
        </div>
      </Section>

      {/* Instrucciones Personalizadas */}
      <Section title="Instrucciones Personalizadas">
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            Instrucciones Adicionales (Texto Libre)
          </label>
          <textarea
            value={behavior.customInstructions}
            onChange={(e) => updateBehavior('customInstructions', e.target.value)}
            placeholder="Ej: 'Siempre menciona el contexto histórico cuando habla de mercados', 'Nunca usa jerga técnica sin explicarla'"
            rows={6}
            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
          />
          <p className="mt-2 text-xs text-white/50">
            Instrucciones específicas que no están cubiertas por los campos anteriores
          </p>
        </div>
      </Section>

      {/* Ejemplos de Diálogo */}
      <Section title="Ejemplos de Diálogo">
        <div className="space-y-4">
          <TextArrayInput
            label="Buenos Ejemplos"
            value={behavior.dialogueExamples.good}
            onChange={(v) => updateNested('dialogueExamples', 'good', v)}
            placeholder="Ejemplos de diálogos que reflejan bien el personaje"
            rows={3}
          />

          <TextArrayInput
            label="Malos Ejemplos (Qué NO hacer)"
            value={behavior.dialogueExamples.bad}
            onChange={(v) => updateNested('dialogueExamples', 'bad', v)}
            placeholder="Ejemplos de lo que el personaje NO debería decir"
            rows={3}
          />
        </div>
      </Section>
    </div>
  );
};

// Helper Components
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-4 p-4 bg-white/[0.01] rounded-lg border border-white/5">
    <h4 className="text-lg font-semibold text-white border-b border-white/10 pb-2">
      {title}
    </h4>
    {children}
  </div>
);

const TextArrayInput: React.FC<{
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  helpText?: string;
  rows?: number;
}> = ({ label, value, onChange, placeholder, helpText, rows = 2 }) => {
  const [inputValue, setInputValue] = useState('');

  const addItem = () => {
    if (inputValue.trim()) {
      onChange([...value, inputValue.trim()]);
      setInputValue('');
    }
  };

  const removeItem = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div>
      <label className="block text-sm font-medium text-white/80 mb-2">
        {label}
      </label>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addItem())}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
        <button
          type="button"
          onClick={addItem}
          className="px-4 py-2 bg-accent-500/20 hover:bg-accent-500/30 text-accent-400 rounded-lg transition-colors"
        >
          Añadir
        </button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((item, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-sm text-white/80"
            >
              {item}
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="text-white/40 hover:text-white/80 transition-colors"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {helpText && (
        <p className="mt-2 text-xs text-white/50">{helpText}</p>
      )}
    </div>
  );
};
