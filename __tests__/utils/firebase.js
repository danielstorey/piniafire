import fs from 'fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';

export const testUser = {
    uid: 'userid',
    displayName: 'Test User',
    email: 'testuser@example.com',
};
let uid = null;
let ctx = null;
let db = null;
let app = null;


export const setupFirebase = () => initializeTestEnvironment({
    projectId: 'test-project',
    firestore: {
        rules: fs.readFileSync('./__tests__/utils/firestore.rules', 'utf8'),
        host: '127.0.0.1',
        port: 8080,
    }
});


export function setUserId(id) {
    uid = id;
}

export async function getApp() {
    if (app) return app;

    app = await setupFirebase();

    return app;
}

export async function getDB() {
    if (db) return db;

    const app = await getApp();

    if (uid) {
        ctx = app.authenticatedContext(uid);
    } else {
        ctx = app.unauthenticatedContext();
    }

    db = ctx.firestore();

    return db;
}

export function getCtx() {
    return ctx;
}

export function getStorage() {
    return ctx.storage();
}

export async function fetchAsAdmin(collection, id, prop) {
    let returnVal;

    await app.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        const document = await getDoc(doc(db, collection, id));

        returnVal = document.data()[prop];
    });

    return returnVal;
}
