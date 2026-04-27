# ClipAI — Editor de vídeo com IA para influenciadores

## Como rodar

### Requisitos
- Node.js 18+ instalado (https://nodejs.org)

### Passos

```bash
# 1. Entre na pasta do projeto
cd clipai-app

# 2. Inicie o servidor (não precisa instalar nada — usa só módulos nativos do Node)
node server.js

# 3. Abra no navegador
http://localhost:3000
```

## Chaves de API já configuradas no server.js
- **Shotstack Sandbox**: ativa por padrão (vídeos com marca d'água)
- **Shotstack Production**: descomente a linha no server.js quando for lançar

## Trocar para produção
Abra `server.js` e mude:
```js
const SHOTSTACK_ENV = 'v1'; // era 'stage'
```
E a linha da chave:
```js
const SHOTSTACK_KEY = SHOTSTACK_KEY_PRODUCTION; // era SANDBOX
```

## Estrutura
```
clipai-app/
├── server.js    ← servidor proxy Node.js (resolve CORS)
├── index.html   ← frontend completo do app
└── README.md
```
