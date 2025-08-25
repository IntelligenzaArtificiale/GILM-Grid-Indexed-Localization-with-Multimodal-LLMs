/*!
 * GILM Providers Module (UMD) - adapter ai provider LLM/VLM
 * AGPL-3.0-or-later
 *
 * Ogni provider espone:
 * - name(): string
 * - generate(parts: Array<{type:"text"|"image_base64", text?, data?, mime?}>): Promise<string>
 *
 * L'utente fornisce la API key quando istanzia il provider.
 */
(function (root, factory) {
  if (typeof define === "function" && define.amd) define([], factory);
  else if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GILMProviders = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Interfaccia base (documentativa) */
  function ProviderBase() { /* no-op */ }
  ProviderBase.prototype.name = function() { 
    throw new Error("[GILMProviders] ProviderBase.name: Not implemented"); 
  };
  ProviderBase.prototype.generate = async function(/* parts */) { 
    throw new Error("[GILMProviders] ProviderBase.generate: Not implemented"); 
  };

  /**
   * OpenAIProvider(apiKey, { model })
   * Endpoint riferimento (Chat Completions API, multimodale; immagini via URL o base64)
   */
  function OpenAIProvider(apiKey, opts) {
    this._apiKey = apiKey;
    this._model = (opts && opts.model) || "gpt-4o-mini";
    this._baseURL = "https://api.openai.com/v1/chat/completions";
  }

  OpenAIProvider.prototype = Object.create(ProviderBase.prototype);
  OpenAIProvider.prototype.constructor = OpenAIProvider;
  OpenAIProvider.prototype.name = function() { return "openai"; };

  OpenAIProvider.prototype.generate = async function(parts) {
    const messages = [{
      role: "user",
      content: []
    }];

    for (const part of parts) {
      if (part.type === "text") {
        messages[0].content.push({
          type: "text",
          text: part.text
        });
      } else if (part.type === "image_base64") {
        // Verifica che i dati base64 siano validi
        if (!part.data) {
          throw new Error("Dati immagine base64 mancanti");
        }
        messages[0].content.push({
          type: "image_url",
          image_url: {
            url: `data:${part.mime || 'image/jpeg'};base64,${part.data}`
          }
        });
      }
    }

    const payload = {
      model: this._model,
      messages: messages,
      max_tokens: 1000
    };

    console.log('[OpenAI] Invio richiesta al modello:', this._model);

    const response = await fetch(this._baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this._apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[OpenAI] Error response:', error);
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    console.log('[OpenAI] Risposta ricevuta con successo');
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('[OpenAI] Struttura risposta inaspettata:', data);
      throw new Error("Risposta OpenAI in formato inaspettato");
    }
    
    return data.choices[0].message.content || "";
  };

  /**
   * AnthropicProvider(apiKey, { model })
   * Endpoint riferimento (Messages API; immagini in content come base64 o URL)
   */
  function AnthropicProvider(apiKey, opts) {
    this._apiKey = apiKey;
    this._model = (opts && opts.model) || "claude-3-7-sonnet";
    this._baseURL = "https://api.anthropic.com/v1/messages";
  }

  AnthropicProvider.prototype = Object.create(ProviderBase.prototype);
  AnthropicProvider.prototype.constructor = AnthropicProvider;
  AnthropicProvider.prototype.name = function() { return "anthropic"; };

  AnthropicProvider.prototype.generate = async function(parts) {
    const content = [];

    for (const part of parts) {
      if (part.type === "text") {
        content.push({
          type: "text",
          text: part.text
        });
      } else if (part.type === "image_base64") {
        // Verifica che i dati base64 siano validi
        if (!part.data) {
          throw new Error("Dati immagine base64 mancanti");
        }
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: part.mime || "image/jpeg",
            data: part.data
          }
        });
      }
    }

    const payload = {
      model: this._model,
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: content
      }]
    };

    console.log('[Anthropic] Invio richiesta al modello:', this._model);

    const response = await fetch(this._baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this._apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Anthropic] Error response:', error);
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    console.log('[Anthropic] Risposta ricevuta con successo');
    
    if (!data.content || data.content.length === 0) {
      console.error('[Anthropic] Struttura risposta inaspettata:', data);
      throw new Error("Contenuto mancante nella risposta Anthropic");
    }
    
    return data.content[0]?.text || "";
  };

  /**
   * GoogleProvider(apiKey, { model })
   * Endpoint riferimento (Gemini API generateContent; inlineData base64)
   */
  function GoogleProvider(apiKey, opts) {
    this._apiKey = apiKey;
    this._model = (opts && opts.model) || "gemini-2.5-flash";
  }

  GoogleProvider.prototype = Object.create(ProviderBase.prototype);
  GoogleProvider.prototype.constructor = GoogleProvider;
  GoogleProvider.prototype.name = function() { return "google"; };

  GoogleProvider.prototype.generate = async function(parts) {
    const contents = [{
      parts: []
    }];

    for (const part of parts) {
      if (part.type === "text") {
        contents[0].parts.push({
          text: part.text
        });
      } else if (part.type === "image_base64") {
        // Verifica che i dati base64 siano validi
        if (!part.data) {
          throw new Error("Dati immagine base64 mancanti");
        }
        contents[0].parts.push({
          inlineData: {
            mimeType: part.mime || "image/jpeg",
            data: part.data
          }
        });
      }
    }

    const payload = {
      contents: contents,
      generationConfig: {
        maxOutputTokens: 1000
      }
    };

    const baseURL = `https://generativelanguage.googleapis.com/v1beta/models/${this._model}:generateContent`;
    const url = `${baseURL}?key=${this._apiKey}`;

    console.log('[Google] Invio richiesta al modello:', this._model);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Google] Error response:', error);
      throw new Error(`Google API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    console.log('[Google] Risposta ricevuta con successo');
    
    // Gestione robusta della risposta Google
    if (!data.candidates || data.candidates.length === 0) {
      console.error('[Google] Struttura risposta inaspettata:', data);
      throw new Error("Nessun candidato nella risposta Google Gemini");
    }
    
    const candidate = data.candidates[0];
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      console.error('[Google] Contenuto candidato mancante:', candidate);
      throw new Error("Contenuto mancante nella risposta Google Gemini");
    }
    
    return candidate.content.parts[0].text || "";
  };

  /**
   * createProvider(id, { apiKey, model, ... })
   * id: "openai" | "anthropic" | "google" | funzione factory custom
   */
  function createProvider(id, cfg) {
    if (typeof id === "function") return id(cfg); // factory custom utente
    if (id === "openai") return new OpenAIProvider(cfg.apiKey, { model: cfg.model });
    if (id === "anthropic") return new AnthropicProvider(cfg.apiKey, { model: cfg.model });
    if (id === "google") return new GoogleProvider(cfg.apiKey, { model: cfg.model });
    throw new Error(`[GILMProviders] Provider "${id}" non riconosciuto`);
  }

  return {
    ProviderBase,
    OpenAIProvider,
    AnthropicProvider,
    GoogleProvider,
    createProvider
  };
});