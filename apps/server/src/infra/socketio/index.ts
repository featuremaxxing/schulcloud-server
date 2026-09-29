/** **********************************************************
 * This is a module facade.                                  *
 * Export only what is allowed to be used externally.        *
 * Do not use wildcard exports.                              *
 * Do not export *.app.module.ts here; import them directly. *
 *********************************************************** */

export { MongoIoAdapter, SOCKETIO_ADAPTER_COLLECTION_NAME } from './mongodb-ioadapter';
export { Socket } from './types';
export { WsValidationPipe } from './ws-validation.pipe';
