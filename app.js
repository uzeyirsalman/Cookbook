import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signInAnonymously, 
    signInWithPopup,
    GoogleAuthProvider,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore,
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    collection, 
    doc, 
    onSnapshot, 
    addDoc, 
    updateDoc, 
    deleteDoc, 
    serverTimestamp, 
    setDoc,
    query,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- CONFIG & INITIALIZATION ---
const firebaseConfig = {
    apiKey: "AIzaSyCaR1QOk6_EOtPeDwqS4NAKc3pRHWlaTAM",
    authDomain: "cookbook-usle.firebaseapp.com",
    projectId: "cookbook-usle",
    storageBucket: "cookbook-usle.firebasestorage.app",
    messagingSenderId: "817755572002",
    appId: "1:817755572002:web:85a543cea320842294877b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let db;
try {
    db = initializeFirestore(app, {
        localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager()
        })
    });
} catch (err) {
    db = getFirestore(app);
}

// --- STATE MANAGEMENT ---
let appState = {
    currentUserId: null,
    currentUserEmail: null,
    isGoogleUser: false,
    showOnlyOwnRecipes: false,
    allRecipes: [],
    lastSelectedTag: null,
    wakeLockSentinel: null,
    unsubscribeFromRecipes: null,
    unsubscribeFromLogs: null
};

window.exportData = appState;

// --- INITIALIZATION & PWA REGISTRATION ---
document.addEventListener('DOMContentLoaded', () => {
    registerServiceWorker();
    handleAuthentication();
    setupScrollListener();
    window.addEventListener('popstate', router);

    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && appState.wakeLockSentinel && appState.wakeLockSentinel.released) {
            const detailContainer = document.getElementById('recipe-detail-container');
            if (detailContainer && !detailContainer.classList.contains('hidden')) {
                await requestWakeLock(true);
            }
        }
    });
});

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    const isLocalhost =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';

    if (isLocalhost) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
            registrations.forEach((reg) => reg.unregister());
        });
        if ('caches' in window) {
            caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
        }
        return;
    }

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/sw.js')
            .then((reg) => reg.update())
            .catch((err) => {
                console.warn('Service Worker registration skipped:', err);
            });
    });
}

// --- SCREEN WAKE LOCK (COOK MODE FOR PIXEL 9A) ---
async function requestWakeLock(silent = false) {
    if (!('wakeLock' in navigator)) {
        if (!silent) showNotification("Screen Wake Lock is not supported on this browser.");
        return false;
    }
    try {
        appState.wakeLockSentinel = await navigator.wakeLock.request('screen');
        updateWakeLockUI(true);
        appState.wakeLockSentinel.addEventListener('release', () => {
            updateWakeLockUI(false);
        });
        if (!silent) showNotification("Cook Mode on: screen will stay awake.");
        return true;
    } catch (err) {
        console.warn("Wake Lock error:", err);
        if (!silent) showNotification("Could not activate Cook Mode.");
        return false;
    }
}

async function releaseWakeLock(silent = true) {
    if (appState.wakeLockSentinel) {
        try {
            await appState.wakeLockSentinel.release();
        } catch (_) {}
        appState.wakeLockSentinel = null;
    }
    updateWakeLockUI(false);
    if (!silent) showNotification("Cook Mode off.");
}

async function toggleWakeLock() {
    if (appState.wakeLockSentinel && !appState.wakeLockSentinel.released) {
        await releaseWakeLock(false);
    } else {
        await requestWakeLock(false);
    }
}

function updateWakeLockUI(isActive) {
    const btn = document.getElementById('wake-lock-toggle-btn');
    if (!btn) return;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    const label = btn.querySelector('.wake-lock-label');
    if (label) {
        label.textContent = isActive ? 'Screen Awake' : 'Keep Screen On';
    }
}

// --- SCROLL LOGIC FOR HEADER ---
function setupScrollListener() {
    let lastScrollTop = 0;
    const header = document.getElementById('main-header');

    window.addEventListener('scroll', () => {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        if (scrollTop <= 0) {
            header.classList.remove('header-hidden');
            lastScrollTop = 0;
            return;
        }

        if (scrollTop > lastScrollTop && scrollTop > 80 && !header.classList.contains('search-active')) {
            header.classList.add('header-hidden');
        } else if (scrollTop < lastScrollTop - 8) {
            header.classList.remove('header-hidden');
        }

        lastScrollTop = scrollTop;
    }, { passive: true });
}

// --- AUTHENTICATION ---
function handleAuthentication() {
    onAuthStateChanged(auth, async (user) => {
        if (user && !user.isAnonymous) {
            appState.currentUserId = user.uid;
            appState.currentUserEmail = user.email || "Google User";
            appState.isGoogleUser = true;

            const userSection = document.getElementById('drawer-user-section');
            if (userSection) {
                userSection.classList.remove('hidden');
                const userPhoto = user.photoURL || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z' fill='%2365635D'/%3E%3C/svg%3E";
                const avatarEl = document.getElementById('drawer-user-avatar');
                if (avatarEl) avatarEl.src = userPhoto;
                const nameEl = document.getElementById('drawer-user-name');
                if (nameEl) nameEl.textContent = user.displayName || "Google User";
            }

            const guestSection = document.getElementById('drawer-guest-section');
            if (guestSection) guestSection.classList.add('hidden');
            document.getElementById('drawer-login-btn').classList.add('hidden');
            document.getElementById('drawer-logout-btn').classList.remove('hidden');

            document.getElementById('menu-add-recipe-row').classList.remove('hidden');
            document.getElementById('drawer-filter-section').classList.remove('hidden');
            const filterCheckbox = document.getElementById('own-recipes-filter');
            if (filterCheckbox) {
                filterCheckbox.checked = appState.showOnlyOwnRecipes;
            }

            if (appState.currentUserEmail === 'uzeyirsalman@gmail.com') {
                document.getElementById('menu-settings-row').classList.remove('hidden');
                listenForActivityLogs();
            } else {
                document.getElementById('menu-settings-row').classList.add('hidden');
                if (appState.unsubscribeFromLogs) {
                    appState.unsubscribeFromLogs();
                }
            }

            setupRegisteredButtons();
            await migrateExistingRecipes();
            listenForRecipes(router);
        } else {
            appState.currentUserId = user ? user.uid : null;
            appState.currentUserEmail = "Guest";
            appState.isGoogleUser = false;
            appState.showOnlyOwnRecipes = false;

            const userSection = document.getElementById('drawer-user-section');
            if (userSection) {
                userSection.classList.add('hidden');
            }

            const guestSection = document.getElementById('drawer-guest-section');
            if (guestSection) guestSection.classList.remove('hidden');
            document.getElementById('drawer-login-btn').classList.remove('hidden');
            document.getElementById('drawer-logout-btn').classList.add('hidden');

            document.getElementById('menu-add-recipe-row').classList.add('hidden');
            document.getElementById('menu-settings-row').classList.add('hidden');
            document.getElementById('drawer-filter-section').classList.add('hidden');

            if (appState.unsubscribeFromLogs) {
                appState.unsubscribeFromLogs();
            }

            setupRegisteredButtons();

            if (!user) {
                try {
                    await signInAnonymously(auth);
                } catch (error) {
                    console.error("Anonymous authentication failed:", error);
                    showNotification("Guest authentication failed.");
                }
            } else {
                listenForRecipes(router);
            }
        }
    });
}

// --- REGISTER BUTTON EVENT LISTENERS ---
let listenersSet = false;
function setupRegisteredButtons() {
    if (listenersSet) return;
    listenersSet = true;

    const homeBtn = document.getElementById('home-btn');
    homeBtn.addEventListener('click', () => {
        clearSearchBar();
        displayTags();
    });
    homeBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            clearSearchBar();
            displayTags();
        }
    });

    document.getElementById('recipe-form').addEventListener('submit', handleFormSubmit);

    const formCancelBtn = document.getElementById('form-cancel-btn');
    if (formCancelBtn) {
        formCancelBtn.addEventListener('click', () => {
            const editingId = document.getElementById('recipe-form').getAttribute('data-editing-id');
            if (editingId) {
                displayRecipeDetails(editingId);
            } else {
                displayTags();
            }
        });
    }

    // Search Listeners (Live input + Enter key + Clear button)
    const searchBtn = document.getElementById('search-btn');
    const searchInput = document.getElementById('search-input');
    const searchClearBtn = document.getElementById('search-clear-btn');

    searchBtn.addEventListener('click', () => toggleSearchInput(true));
    searchInput.addEventListener('input', handleLiveSearch);
    searchInput.addEventListener('keydown', handleSearch);

    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
            clearSearchBar();
            displayTags();
        });
    }

    // Settings/Backup modal close and action listeners
    document.getElementById('settings-close-btn').addEventListener('click', closeSettingsModal);
    document.getElementById('export-backup-btn').addEventListener('click', handleExportBackup);
    document.getElementById('import-file-input').addEventListener('change', handleImportBackup);

    // Slide-out Drawer Open/Close Toggle listeners
    const menuToggle = document.getElementById('menu-toggle-btn');
    const menuClose = document.getElementById('menu-close-btn');
    const menuBackdrop = document.getElementById('menu-backdrop');
    const navDrawer = document.getElementById('nav-drawer');

    const toggleDrawer = (open) => {
        if (open) {
            navDrawer.classList.remove('hidden');
            menuBackdrop.classList.remove('hidden');
        } else {
            navDrawer.classList.add('hidden');
            menuBackdrop.classList.add('hidden');
        }
    };

    if (menuToggle) menuToggle.addEventListener('click', () => toggleDrawer(true));
    if (menuClose) menuClose.addEventListener('click', () => toggleDrawer(false));
    if (menuBackdrop) menuBackdrop.addEventListener('click', () => toggleDrawer(false));

    // Drawer Menu Actions
    document.getElementById('menu-add-recipe-btn').addEventListener('click', () => {
        toggleDrawer(false);
        if (appState.isGoogleUser) {
            showAddRecipeForm();
        } else {
            showNotification("Please sign in with Google to add recipes.");
        }
    });

    document.getElementById('menu-random-recipe-btn').addEventListener('click', (e) => {
        toggleDrawer(false);
        handleRandomClick(e);
    });

    const menuFmdBtn = document.getElementById('menu-fmd-btn');
    if (menuFmdBtn) {
        menuFmdBtn.addEventListener('click', () => {
            toggleDrawer(false);
            displayRecipesByTag('Fmd');
        });
    }

    document.getElementById('menu-settings-btn').addEventListener('click', () => {
        toggleDrawer(false);
        openSettingsModal();
    });

    // Google Auth actions in Drawer
    document.getElementById('drawer-login-btn').addEventListener('click', () => {
        toggleDrawer(false);
        handleGoogleSignIn();
    });

    document.getElementById('drawer-logout-btn').addEventListener('click', () => {
        toggleDrawer(false);
        handleSignOut();
    });

    // "My Recipes Only" filter checkbox listener
    const filterCheckbox = document.getElementById('own-recipes-filter');
    if (filterCheckbox) {
        filterCheckbox.addEventListener('change', (e) => {
            appState.showOnlyOwnRecipes = e.target.checked;
            router();
        });
    }

    // Mobile Bottom Navigation Bar Listeners
    const navHomeBtn = document.getElementById('nav-home-btn');
    const navSearchBtn = document.getElementById('nav-search-btn');
    const navRandomBtn = document.getElementById('nav-random-btn');
    const navFmdBtn = document.getElementById('nav-fmd-btn');
    const navMenuBtn = document.getElementById('nav-menu-btn');

    if (navHomeBtn) {
        navHomeBtn.addEventListener('click', () => {
            clearSearchBar();
            displayTags();
        });
    }
    if (navSearchBtn) {
        navSearchBtn.addEventListener('click', () => {
            const header = document.getElementById('main-header');
            header.classList.remove('header-hidden');
            toggleSearchInput(true);
        });
    }
    if (navRandomBtn) {
        navRandomBtn.addEventListener('click', (e) => handleRandomClick(e));
    }
    if (navFmdBtn) {
        navFmdBtn.addEventListener('click', () => {
            clearSearchBar();
            displayRecipesByTag('Fmd');
        });
    }
    if (navMenuBtn) {
        navMenuBtn.addEventListener('click', () => toggleDrawer(true));
    }
}

function setActiveBottomNav(navKey) {
    document.querySelectorAll('.bottom-nav-item').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-nav') === navKey);
    });
}

// --- GOOGLE AUTHENTICATION ACTIONS ---
async function handleGoogleSignIn() {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
        showNotification("Signed in successfully!");
    } catch (error) {
        console.error("Google sign in failed:", error);
        showNotification(`Sign in failed: ${error.message || error}`);
    }
}

async function handleSignOut() {
    try {
        if (appState.unsubscribeFromLogs) {
            appState.unsubscribeFromLogs();
        }
        await signOut(auth);
        showNotification("Signed out successfully.");
        router();
    } catch (error) {
        console.error("Sign out failed:", error);
        showNotification("Failed to sign out.");
    }
}

// --- ONE-TIME AUTHOR MIGRATION ---
async function migrateExistingRecipes() {
    if (!appState.isGoogleUser) return;
    if (localStorage.getItem('cookbook_migrated_author_2026') === 'true') return;

    const recipesToMigrate = appState.allRecipes.filter(r => !r.author || r.author === 'system');
    if (recipesToMigrate.length === 0) {
        localStorage.setItem('cookbook_migrated_author_2026', 'true');
        return;
    }

    const recipesCollection = getSharedRecipesCollection();
    let migrateCount = 0;

    for (const recipe of recipesToMigrate) {
        try {
            const recipeRef = doc(recipesCollection, recipe.id);
            await updateDoc(recipeRef, {
                author: "uzeyirsalman@gmail.com",
                userId: appState.currentUserId
            });
            migrateCount++;
        } catch (err) {
            console.error(`Migration failed for: ${recipe.title}`, err);
        }
    }

    if (migrateCount > 0) {
        showNotification(`Database migrated: assigned ${migrateCount} recipes to you.`);
        await logActivity("migrate", "multiple_recipes", `Migrated ${migrateCount} recipes' author to uzeyirsalman@gmail.com`);
    }

    localStorage.setItem('cookbook_migrated_author_2026', 'true');
}

// --- CHANGE LOGGING (CHANGELOG) ---
async function logActivity(action, recipeId, recipeTitle) {
    try {
        const logsCol = collection(db, 'artifacts', firebaseConfig.projectId, 'activity-log');
        await addDoc(logsCol, {
            action: action,
            recipeId: recipeId,
            recipeTitle: recipeTitle,
            timestamp: serverTimestamp(),
            byWho: appState.currentUserEmail || "Guest",
            userId: appState.currentUserId || "anonymous"
        });
    } catch (err) {
        console.error("Failed to write activity log:", err);
    }
}

function listenForActivityLogs() {
    if (appState.unsubscribeFromLogs) {
        appState.unsubscribeFromLogs();
    }

    const logsCollection = collection(db, 'artifacts', firebaseConfig.projectId, 'activity-log');
    const q = query(logsCollection, orderBy('timestamp', 'desc'), limit(25));
    const listDiv = document.getElementById('activity-log-list');

    if (!listDiv) return;

    appState.unsubscribeFromLogs = onSnapshot(q, (snapshot) => {
        listDiv.innerHTML = '';

        if (snapshot.docs.length === 0) {
            listDiv.innerHTML = `<div class="activity-log-empty">No activity logged yet.</div>`;
            return;
        }

        snapshot.docs.forEach(docSnap => {
            const log = docSnap.data();
            const logItem = document.createElement('div');
            logItem.className = 'activity-log-item';

            let dateStr = 'Just now';
            if (log.timestamp && typeof log.timestamp.toDate === 'function') {
                const date = log.timestamp.toDate();
                dateStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + date.toLocaleDateString([], { month: 'short', day: 'numeric' });
            }

            const action = log.action || 'update';
            const actionUpper = action.toUpperCase();

            logItem.innerHTML = `
                <div class="activity-log-meta">
                    <span class="activity-log-desc">
                        <span class="activity-badge ${action}">${actionUpper}</span>
                        <strong>${log.recipeTitle || 'Recipe'}</strong>
                    </span>
                    <span class="activity-log-by">by ${log.byWho || 'Guest'}</span>
                </div>
                <span class="activity-log-time">${dateStr}</span>
            `;
            listDiv.appendChild(logItem);
        });
    }, error => {
        console.error("Error fetching activity logs:", error);
        listDiv.innerHTML = `<div class="activity-log-empty">Log permission denied.</div>`;
    });
}

// --- SETTINGS / BACKUP MODAL ACTIONS ---
function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    const statusDiv = document.getElementById('import-status');
    if (statusDiv) {
        statusDiv.className = 'import-status';
        statusDiv.textContent = '';
        statusDiv.style.display = 'none';
    }
    if (modal) modal.classList.remove('hidden');
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('hidden');
}

function handleExportBackup() {
    if (appState.allRecipes.length === 0) {
        showNotification("No recipes available to export.");
        return;
    }

    const exportData = appState.allRecipes.map(recipe => ({
        instructions: recipe.instructions || "",
        ingredients: recipe.ingredients || "",
        title: recipe.title || "",
        tags: recipe.tags || []
    }));

    try {
        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `cookbook-backup-${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showNotification("Recipes exported successfully!");
    } catch (err) {
        console.error("Export failed:", err);
        showNotification("Failed to export recipes.");
    }
}

async function handleImportBackup(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!appState.isGoogleUser || appState.currentUserEmail !== 'uzeyirsalman@gmail.com') {
        showNotification("Permission denied: Settings are exclusive to the admin.");
        return;
    }

    const statusDiv = document.getElementById('import-status');
    if (statusDiv) {
        statusDiv.className = 'import-status info';
        statusDiv.textContent = 'Reading backup file...';
        statusDiv.style.display = 'block';
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const parsedData = JSON.parse(e.target.result);

            if (!Array.isArray(parsedData)) {
                throw new Error("Invalid format: Backup file must be a JSON array.");
            }

            if (parsedData.length === 0) {
                if (statusDiv) {
                    statusDiv.className = 'import-status error';
                    statusDiv.textContent = 'The backup file is empty.';
                }
                return;
            }

            let successCount = 0;
            let duplicateCount = 0;
            let errorCount = 0;

            if (statusDiv) {
                statusDiv.className = 'import-status info';
                statusDiv.textContent = `Importing ${parsedData.length} recipes to Firestore...`;
            }

            const recipesCollection = getSharedRecipesCollection();

            for (const recipe of parsedData) {
                if (!recipe.title) {
                    errorCount++;
                    continue;
                }

                const formattedTitle = toTitleCase(recipe.title.trim());

                let cleanTags = [];
                if (Array.isArray(recipe.tags)) {
                    cleanTags = recipe.tags.map(t => toTitleCase(t.trim())).filter(t => t);
                } else if (typeof recipe.tags === 'string' && recipe.tags) {
                    cleanTags = recipe.tags.split(',').map(t => toTitleCase(t.trim())).filter(t => t);
                }

                const recipeData = {
                    title: formattedTitle,
                    tags: cleanTags,
                    ingredients: recipe.ingredients || "",
                    instructions: recipe.instructions || "",
                    userId: appState.currentUserId,
                    author: appState.currentUserEmail,
                    createdAt: serverTimestamp()
                };

                const existingRecipe = appState.allRecipes.find(r => r.title.toLowerCase() === formattedTitle.toLowerCase());

                try {
                    if (existingRecipe) {
                        const recipeRef = doc(recipesCollection, existingRecipe.id);
                        await updateDoc(recipeRef, recipeData);
                        duplicateCount++;
                    } else {
                        await addDoc(recipesCollection, recipeData);
                        successCount++;
                    }
                } catch (err) {
                    console.error("Failed to import recipe:", recipe.title, err);
                    errorCount++;
                }
            }

            if (statusDiv) {
                statusDiv.className = 'import-status success';
                statusDiv.textContent = `Import completed! Added: ${successCount}, Updated: ${duplicateCount}, Errors: ${errorCount}`;
            }
            showNotification("Recipes imported successfully!");

            if (successCount > 0 || duplicateCount > 0) {
                await logActivity("import", "backup_file", `Imported ${successCount + duplicateCount} backup recipes`);
            }

            event.target.value = '';
        } catch (err) {
            console.error("Import failed:", err);
            if (statusDiv) {
                statusDiv.className = 'import-status error';
                statusDiv.textContent = `Error: ${err.message || 'Failed to parse JSON backup file.'}`;
            }
        }
    };

    reader.readAsText(file);
}

// --- ROUTER ---
function router() {
    const path = window.location.pathname;
    const pathParts = path.split('/').filter(p => p);

    if (pathParts[0] === 'add') {
        if (!appState.isGoogleUser) {
            showNotification("Sign in with Google to create recipes.");
            displayTags(false);
            return;
        }
    }

    if (pathParts[0] === 'tag' && pathParts[1]) {
        const tagName = decodeURIComponent(pathParts[1]);
        displayRecipesByTag(tagName, false);
    } else if (pathParts[0] === 'recipe' && pathParts[1]) {
        const recipeId = pathParts[1];
        if (appState.allRecipes.length > 0) {
            displayRecipeDetails(recipeId, false);
        }
    } else if (pathParts[0] === 'add') {
        showAddRecipeForm(false);
    } else if (pathParts[0] === 'edit' && pathParts[1]) {
        const recipeId = pathParts[1];
        if (appState.allRecipes.length > 0) {
            const recipe = appState.allRecipes.find(r => r.id === recipeId);
            const isOwner = recipe && recipe.userId === appState.currentUserId;
            const isAdmin = appState.currentUserEmail === 'uzeyirsalman@gmail.com';

            if (!appState.isGoogleUser || (!isOwner && !isAdmin)) {
                showNotification("Unauthorized: You do not have permission to edit this recipe.");
                displayTags(false);
                return;
            }
            showEditRecipeForm(recipeId, false);
        }
    } else {
        displayTags(false);
    }
}

// --- DATA MANAGEMENT (FIRESTORE) ---
function getSharedRecipesCollection() {
    const appId = firebaseConfig.projectId;
    return collection(db, 'artifacts', appId, 'public-recipes');
}

function listenForRecipes(onCompleteCallback) {
    if (appState.unsubscribeFromRecipes) {
        appState.unsubscribeFromRecipes();
    }

    const recipesCollection = getSharedRecipesCollection();
    const loader = document.getElementById('loader');

    appState.unsubscribeFromRecipes = onSnapshot(recipesCollection, async (snapshot) => {
        if (loader) loader.classList.add('hidden');

        appState.allRecipes = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));

        if (appState.allRecipes.length === 0) {
            await addDefaultRecipes();
        }

        if (onCompleteCallback) onCompleteCallback();

    }, error => {
        console.error("Error fetching recipes: ", error);
        showNotification("Could not load recipes.");
        if (loader) loader.classList.add('hidden');
    });
}

async function addDefaultRecipes() {
    const recipesCollection = getSharedRecipesCollection();
    const defaultRecipes = [
        { title: 'Shared Tomato Soup', tags: ['Soup', 'Vegetarian', 'Classic'], ingredients: '1 kg ripe tomatoes\n2 tbsp olive oil\n1 onion, chopped', instructions: '1. Sauté onion.\n2. Add tomatoes and broth, simmer.\n3. Blend until smooth.', userId: 'system', author: 'system', createdAt: serverTimestamp() },
        { title: 'Shared Garden Salad', tags: ['Salad', 'Quick', 'Healthy'], ingredients: '1 head of lettuce\n1 cucumber, sliced\n2 tomatoes, chopped', instructions: 'Combine all vegetables in a large bowl and toss with vinaigrette.', userId: 'system', author: 'system', createdAt: serverTimestamp() }
    ];
    for (const recipe of defaultRecipes) {
        const docRef = doc(recipesCollection, recipe.title.replace(/\s+/g, '-').toLowerCase());
        await setDoc(docRef, recipe);
    }
}

// --- UI & VIEW MANAGEMENT ---
function showNotification(message) {
    const notification = document.getElementById('notification');
    if (notification) {
        notification.textContent = message;
        notification.classList.add('show');
        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }
}

function showView(viewId) {
    if (viewId !== 'recipe-detail-container') {
        releaseWakeLock(true);
    }

    ['tag-list-container', 'recipe-list-container', 'recipe-detail-container', 'recipe-form-container', 'search-results-container'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    if (viewId !== 'recipe-list-container') {
        const existingFmdCard = document.querySelector('.fmd-info-card');
        if (existingFmdCard) {
            existingFmdCard.remove();
        }
    }

    const viewToShow = document.getElementById(viewId);
    if (viewToShow) {
        viewToShow.classList.remove('hidden');
        window.scrollTo(0, 0);
    }
}

// --- HELPER FUNCTIONS ---
function toTitleCase(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function getIngredientCount(recipe) {
    if (!recipe || !recipe.ingredients) return 0;
    return recipe.ingredients.split('\n').map(s => s.trim()).filter(Boolean).length;
}

// Unified Minimalist Duotone SVG Category Icons
function getCategoryIcon(tag) {
    const clean = (tag || '').toLowerCase().trim();

    if (clean.includes('pasta') || clean.includes('italian') || clean.includes('noodle')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3L20 19H4L12 3Z" fill="currentColor" fill-opacity="0.14"/>
            <path d="M12 3L20 19H4L12 3Z"/>
            <path d="M5.5 16C9.5 18 14.5 18 18.5 16"/>
            <circle cx="11" cy="11" r="1.2" fill="currentColor"/>
            <circle cx="14" cy="14" r="1.2" fill="currentColor"/>
        </svg>`;
    }
    if (clean.includes('sandwich') || clean.includes('bread')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 15L15 4L20 9L9 20H4V15Z" fill="currentColor" fill-opacity="0.14"/>
            <path d="M3 11L11 3C13.5 3 16 4.5 18 6.5C20 8.5 21 11 21 13.5L13 21.5L3 11Z"/>
            <path d="M7 15L15 7"/>
        </svg>`;
    }
    if (clean.includes('dessert') || clean.includes('sweet') || clean.includes('cake') || clean.includes('cookie') || clean.includes('bake')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 14h16v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5z" fill="currentColor" fill-opacity="0.14"/>
            <path d="M4 14h16v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5z"/>
            <path d="M4 14c0-2.5 2-4 4.5-4 .9 0 1.8.3 2.5.8.7-.5 1.6-.8 2.5-.8 1 0 1.9.3 2.5.8.7-.5 1.5-.8 2.5-.8 2 0 3.5 1.5 3.5 4"/>
            <path d="M12 6v4"/>
            <circle cx="12" cy="4.5" r="1.5" fill="currentColor"/>
        </svg>`;
    }
    if (clean.includes('soup') || clean.includes('stew') || clean.includes('ramen')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12h16a8 8 0 0 1-16 0z" fill="currentColor" fill-opacity="0.14"/>
            <path d="M4 12h16a8 8 0 0 1-16 0z"/>
            <path d="M3 12h18"/>
            <path d="M9 5c0 1.5 1.5 1.5 1.5 3"/>
            <path d="M14 5c0 1.5 1.5 1.5 1.5 3"/>
        </svg>`;
    }
    if (clean.includes('asian') || clean.includes('chinese') || clean.includes('japanese') || clean.includes('korean') || clean.includes('thai')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 13h16a8 8 0 0 1-16 0z" fill="currentColor" fill-opacity="0.14"/>
            <path d="M4 13h16a8 8 0 0 1-16 0z"/>
            <path d="M6 5l14 4"/>
            <path d="M6 9l14-2"/>
        </svg>`;
    }
    if (clean.includes('salad') || clean.includes('green') || clean.includes('healthy') || clean.includes('veg')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" fill="currentColor" fill-opacity="0.14"/>
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
            <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
        </svg>`;
    }
    if (clean.includes('azeri') || clean.includes('plov') || clean.includes('azerbaijan')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 17c0-4.5 3-8 7-8s7 3.5 7 8H5z" fill="currentColor" fill-opacity="0.14"/>
            <path d="M5 17c0-4.5 3-8 7-8s7 3.5 7 8"/>
            <path d="M3 17h18"/>
            <path d="M12 5v2"/>
            <path d="M8 7l1 1.5"/>
            <path d="M16 7l-1 1.5"/>
        </svg>`;
    }
    if (clean.includes('turkish') || clean.includes('kebab') || clean.includes('shish') || clean.includes('turkey')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="20" x2="20" y2="4"/>
            <rect x="7" y="13" width="4" height="4" rx="1" transform="rotate(-45 9 15)" fill="currentColor" fill-opacity="0.14"/>
            <rect x="12" y="8" width="4" height="4" rx="1" transform="rotate(-45 14 10)" fill="currentColor" fill-opacity="0.14"/>
            <circle cx="17.5" cy="6.5" r="2"/>
        </svg>`;
    }
    if (clean.includes('american') || clean.includes('burger') || clean.includes('usa')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 11c0-3.5 3.1-6 7-6s7 2.5 7 6H5z" fill="currentColor" fill-opacity="0.14"/>
            <path d="M5 11c0-3.5 3.1-6 7-6s7 2.5 7 6H5z"/>
            <line x1="4" y1="14.5" x2="20" y2="14.5"/>
            <path d="M5 17.5h14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/>
        </svg>`;
    }
    if (clean.includes('mexican') || clean.includes('burrito') || clean.includes('taco') || clean.includes('mexico') || clean.includes('avocado')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 16c0-5 3.6-9 8-9s8 4 8 9H4z" fill="currentColor" fill-opacity="0.14"/>
            <path d="M4 16c0-5 3.6-9 8-9s8 4 8 9H4z"/>
            <circle cx="9.5" cy="13" r="1" fill="currentColor"/>
            <circle cx="14.5" cy="13" r="1" fill="currentColor"/>
        </svg>`;
    }
    if (clean.includes('indian') || clean.includes('samosa') || clean.includes('curry') || clean.includes('india')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 4L20 19H4L12 4Z" fill="currentColor" fill-opacity="0.14"/>
            <path d="M12 4L20 19H4L12 4Z"/>
            <path d="M12 4L10 19"/>
        </svg>`;
    }
    if (clean === 'fmd' || clean.includes('fast') || clean.includes('quick') || clean.includes('minute')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="13" r="8" fill="currentColor" fill-opacity="0.14"/>
            <circle cx="12" cy="13" r="8"/>
            <path d="M12 9v4l2.5 2.5"/>
            <path d="M9 3h6"/>
        </svg>`;
    }
    if (clean.includes('oven') || clean.includes('roast') || clean.includes('chicken') || clean.includes('meat')) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2.5" fill="currentColor" fill-opacity="0.1"/>
            <rect x="3" y="4" width="18" height="16" rx="2.5"/>
            <rect x="6.5" y="10" width="11" height="7" rx="1"/>
            <circle cx="8" cy="7" r="0.8" fill="currentColor"/>
            <circle cx="12" cy="7" r="0.8" fill="currentColor"/>
            <circle cx="16" cy="7" r="0.8" fill="currentColor"/>
        </svg>`;
    }

    // Default clean culinary cloche icon
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 16c0-4.4 3.6-8 8-8s8 3.6 8 8H4z" fill="currentColor" fill-opacity="0.14"/>
        <path d="M4 16c0-4.4 3.6-8 8-8s8 3.6 8 8H4z"/>
        <circle cx="12" cy="6" r="1.5"/>
        <line x1="2" y1="19" x2="22" y2="19"/>
    </svg>`;
}

function createRecipeCardElement(recipe) {
    const item = document.createElement('div');
    item.className = 'recipe-item';

    const ingCount = getIngredientCount(recipe);
    const tags = (recipe.tags || []).slice(0, 3);

    const mainDiv = document.createElement('div');
    mainDiv.className = 'recipe-item-main';

    const titleEl = document.createElement('h3');
    titleEl.textContent = recipe.title;
    mainDiv.appendChild(titleEl);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'recipe-item-meta';

    tags.forEach((t) => {
        const tagSpan = document.createElement('span');
        tagSpan.className = 'recipe-meta-tag';
        tagSpan.textContent = t;
        metaDiv.appendChild(tagSpan);
    });

    if (ingCount > 0) {
        if (tags.length > 0) {
            const dot = document.createElement('span');
            dot.className = 'recipe-meta-dot';
            dot.textContent = '•';
            metaDiv.appendChild(dot);
        }
        const countSpan = document.createElement('span');
        countSpan.textContent = `${ingCount} ingredient${ingCount === 1 ? '' : 's'}`;
        metaDiv.appendChild(countSpan);
    }

    mainDiv.appendChild(metaDiv);

    const chevronDiv = document.createElement('div');
    chevronDiv.className = 'recipe-item-chevron';
    chevronDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

    item.appendChild(mainDiv);
    item.appendChild(chevronDiv);
    item.addEventListener('click', () => displayRecipeDetails(recipe.id));
    return item;
}

// --- DISPLAY FUNCTIONS ---
function displayTags(updateUrl = true) {
    if (updateUrl) {
        history.pushState({ view: 'tags' }, '', '/');
    }
    appState.lastSelectedTag = null;
    setActiveBottomNav('home');

    let recipes = appState.allRecipes;
    if (appState.isGoogleUser && appState.showOnlyOwnRecipes) {
        recipes = recipes.filter(recipe => recipe.userId === appState.currentUserId);
    }

    const tagCounts = {};
    recipes.forEach(recipe => {
        (recipe.tags || []).forEach(tag => {
            const trimmedTag = tag.trim();
            if (trimmedTag) {
                tagCounts[trimmedTag] = (tagCounts[trimmedTag] || 0) + 1;
            }
        });
    });

    const sortedTags = Object.keys(tagCounts).sort((a, b) => {
        const countDiff = tagCounts[b] - tagCounts[a];
        if (countDiff !== 0) return countDiff;
        return a.localeCompare(b);
    });

    const container = document.getElementById('tag-list-container');
    container.innerHTML = '';

    if (sortedTags.length === 0) {
        container.innerHTML = `<p class="empty-state">No recipes found. Sign in and add one to get started!</p>`;
    } else {
        const sectionBar = document.createElement('div');
        sectionBar.className = 'home-section-bar';
        sectionBar.innerHTML = `
            <h2 class="home-section-title">Categories</h2>
            <span class="count-badge">${recipes.length} total recipes</span>
        `;
        container.appendChild(sectionBar);

        const grid = document.createElement('div');
        grid.className = 'category-grid';

        sortedTags.forEach(tag => {
            const card = document.createElement('div');
            card.className = 'tag-card theme-card';

            const icon = getCategoryIcon(tag);
            const count = tagCounts[tag];

            card.innerHTML = `
                <div class="theme-card-top">
                    <span class="theme-icon">${icon}</span>
                    <span class="theme-count">${count}</span>
                </div>
                <span class="theme-title">${tag}</span>
            `;
            card.addEventListener('click', () => displayRecipesByTag(tag));
            grid.appendChild(card);
        });

        container.appendChild(grid);
    }
    showView('tag-list-container');
}

function displayRecipesByTag(tag, updateUrl = true) {
    if (updateUrl) {
        const url = `/tag/${encodeURIComponent(tag)}`;
        history.pushState({ view: 'recipeList', tag: tag }, '', url);
    }
    appState.lastSelectedTag = tag;
    setActiveBottomNav(tag.toLowerCase() === 'fmd' ? 'fmd' : 'home');

    let recipes = appState.allRecipes.filter(recipe => recipe.tags && recipe.tags.includes(tag));
    if (appState.isGoogleUser && appState.showOnlyOwnRecipes) {
        recipes = recipes.filter(recipe => recipe.userId === appState.currentUserId);
    }

    const listDiv = document.getElementById('recipe-list');
    listDiv.innerHTML = '';

    const existingFmdCard = document.querySelector('.fmd-info-card');
    if (existingFmdCard) {
        existingFmdCard.remove();
    }

    // Category Header (Title + Recipe Count Badge)
    const viewHeader = document.createElement('div');
    viewHeader.className = 'view-header';

    const titleEl = document.createElement('h2');
    titleEl.className = 'view-title';
    titleEl.textContent = tag;

    const countBadge = document.createElement('span');
    countBadge.className = 'count-badge';
    countBadge.textContent = `${recipes.length} recipe${recipes.length === 1 ? '' : 's'}`;

    viewHeader.appendChild(titleEl);
    viewHeader.appendChild(countBadge);
    listDiv.appendChild(viewHeader);

    if (recipes.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No recipes found in this category.';
        listDiv.appendChild(empty);
    } else {
        recipes.forEach(recipe => {
            listDiv.appendChild(createRecipeCardElement(recipe));
        });
    }

    if (tag.toLowerCase() === 'fmd') {
        const fmdInfoCard = document.createElement('div');
        fmdInfoCard.className = 'fmd-info-card';
        fmdInfoCard.innerHTML = `
            <h3>Fasting Mimicking Diet (FMD) Protocol</h3>
            <p>The Fasting Mimicking Diet is designed to trigger the physiological benefits of water fasting (such as cellular clean-up/autophagy) while providing essential macronutrients from clean, plant-based fats and complex carbohydrates.</p>
            
            <h4>Core Rules</h4>
            <ol>
                <li><strong>No Additions:</strong> Do not add animal protein, dairy, sugar, or extra cooking oil.</li>
                <li><strong>Preserve Fats:</strong> Boil soup vegetables in salted water. Remove from heat before blending and stirring in olive oil. Heating high-quality extra virgin olive oil aggressively damages healthy fats.</li>
                <li><strong>Dry Weight:</strong> Always weigh quinoa dry before cooking it.</li>
            </ol>

            <h4>Autophagy &amp; Alternate-Day Fasting (ADF/ATF)</h4>
            <p>FMD macros restrict protein to strictly below 10%, turning off the mTOR pathway. To maximize autophagy, integrate these days into an Alternate-Day Fasting rotation. Fast from your last feast meal (feast day dinner) through the entire FMD day, until breakfast of the next feast day, maximizing consecutive hours of autophagic flux.</p>
        `;
        const container = document.getElementById('recipe-list-container');
        if (container) {
            container.appendChild(fmdInfoCard);
        }
    }

    showView('recipe-list-container');
}

function displayRecipeDetails(recipeId, updateUrl = true) {
    const recipe = appState.allRecipes.find(r => r.id === recipeId);
    if (!recipe) {
        console.error("Recipe not found with ID:", recipeId);
        showNotification("Sorry, that recipe could not be found.");
        router();
        return;
    }

    if (updateUrl) {
        const url = `/recipe/${recipeId}`;
        history.pushState({ view: 'recipeDetail', recipeId: recipeId }, '', url);
    }

    const detailContainer = document.getElementById('recipe-detail');
    detailContainer.innerHTML = '';
    detailContainer.classList.add('fade-in-view');

    // Header: Starts directly with the Recipe Title at the top, followed by Tags + Keep Screen On row
    const header = document.createElement('div');
    header.className = 'recipe-detail-header';
    const titleTagsWrapper = document.createElement('div');
    titleTagsWrapper.className = 'recipe-title-tags-wrapper';

    const title = document.createElement('h2');
    title.id = 'recipe-title-detail';
    title.textContent = recipe.title;

    const metaRow = document.createElement('div');
    metaRow.className = 'recipe-meta-row';

    const tags = document.createElement('div');
    tags.id = 'recipe-tags-detail';
    (recipe.tags || []).forEach(tag => {
        const tagEl = document.createElement('button');
        tagEl.type = 'button';
        tagEl.className = 'tag-item';
        tagEl.textContent = tag;
        tagEl.addEventListener('click', () => displayRecipesByTag(tag));
        tags.appendChild(tagEl);
    });

    const wakeLockBtn = document.createElement('button');
    wakeLockBtn.type = 'button';
    wakeLockBtn.id = 'wake-lock-toggle-btn';
    wakeLockBtn.className = 'wake-lock-btn';
    wakeLockBtn.setAttribute('aria-pressed', 'false');
    wakeLockBtn.innerHTML = `
        <span class="wake-lock-dot"></span>
        <span class="wake-lock-label">Keep Screen On</span>
    `;
    wakeLockBtn.addEventListener('click', toggleWakeLock);

    metaRow.appendChild(tags);
    metaRow.appendChild(wakeLockBtn);

    titleTagsWrapper.appendChild(title);
    titleTagsWrapper.appendChild(metaRow);
    header.appendChild(titleTagsWrapper);
    detailContainer.appendChild(header);

    // Ingredients Section with Live Progress Counter
    const rawIngredients = (recipe.ingredients || '').split('\n').map(s => s.trim()).filter(Boolean);
    const ingHeader = document.createElement('div');
    ingHeader.className = 'detail-section-header';

    const ingredientsTitle = document.createElement('h3');
    ingredientsTitle.textContent = 'Ingredients';

    const progressPill = document.createElement('span');
    progressPill.className = 'progress-pill';
    progressPill.textContent = `0 / ${rawIngredients.length}`;

    ingHeader.appendChild(ingredientsTitle);
    if (rawIngredients.length > 0) {
        ingHeader.appendChild(progressPill);
    }
    detailContainer.appendChild(ingHeader);

    const ingredientsList = document.createElement('ul');
    ingredientsList.id = 'recipe-ingredients-detail';

    const updateIngredientProgress = () => {
        const checkedCount = ingredientsList.querySelectorAll('input[type="checkbox"]:checked').length;
        progressPill.textContent = `${checkedCount} / ${rawIngredients.length}`;
    };

    rawIngredients.forEach((ing, idx) => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        label.className = 'ingredient-checkbox-wrapper';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `ing-${idx}`;
        checkbox.addEventListener('change', updateIngredientProgress);

        const customSpan = document.createElement('span');
        customSpan.className = 'ingredient-checkbox-custom';

        const textSpan = document.createElement('span');
        textSpan.className = 'ingredient-text';
        textSpan.textContent = ing;

        label.appendChild(checkbox);
        label.appendChild(customSpan);
        label.appendChild(textSpan);
        li.appendChild(label);
        ingredientsList.appendChild(li);
    });
    detailContainer.appendChild(ingredientsList);

    // Instructions Section (Structured Tappable Step Cards)
    const instHeader = document.createElement('div');
    instHeader.className = 'detail-section-header';
    const instructionsTitle = document.createElement('h3');
    instructionsTitle.textContent = 'Instructions';
    instHeader.appendChild(instructionsTitle);
    detailContainer.appendChild(instHeader);

    const instructionsContainer = document.createElement('div');
    instructionsContainer.id = 'recipe-instructions-detail';

    const rawSteps = (recipe.instructions || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    if (rawSteps.length === 0) {
        const emptyStep = document.createElement('p');
        emptyStep.className = 'step-text';
        emptyStep.textContent = 'No instructions provided.';
        instructionsContainer.appendChild(emptyStep);
    } else {
        rawSteps.forEach((stepLine, index) => {
            const cleanStepText = stepLine.replace(/^\d+[\.\)]\s*/, '');
            const stepCard = document.createElement('div');
            stepCard.className = 'instruction-step';

            const stepNum = document.createElement('span');
            stepNum.className = 'step-number';
            stepNum.textContent = String(index + 1);

            const stepBody = document.createElement('div');
            stepBody.className = 'step-text';
            stepBody.textContent = cleanStepText;

            stepCard.appendChild(stepNum);
            stepCard.appendChild(stepBody);

            stepCard.addEventListener('click', () => {
                stepCard.classList.toggle('step-done');
            });

            instructionsContainer.appendChild(stepCard);
        });
    }
    detailContainer.appendChild(instructionsContainer);

    // Edit/Delete Actions for Owner or Admin
    const isOwner = recipe.userId === appState.currentUserId;
    const isAdmin = appState.currentUserEmail === 'uzeyirsalman@gmail.com';

    if (appState.isGoogleUser && (isOwner || isAdmin)) {
        const actionsContainer = document.createElement('div');
        actionsContainer.id = 'recipe-actions';
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.textContent = 'Edit Recipe';
        editButton.className = 'action-button edit-btn';
        editButton.onclick = () => showEditRecipeForm(recipe.id);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.textContent = 'Delete';
        deleteButton.className = 'action-button delete-btn';
        deleteButton.onclick = () => confirmDelete(recipe.id, recipe.title);

        actionsContainer.appendChild(editButton);
        actionsContainer.appendChild(deleteButton);
        detailContainer.appendChild(actionsContainer);
    }

    showView('recipe-detail-container');

    setTimeout(() => {
        detailContainer.classList.remove('fade-in-view');
    }, 300);
}

function handleRandomClick(event) {
    if (event) event.preventDefault();
    if (appState.allRecipes.length === 0) {
        showNotification("No recipes available to choose from.");
        return;
    }
    setActiveBottomNav('random');
    const randomIndex = Math.floor(Math.random() * appState.allRecipes.length);
    const randomRecipe = appState.allRecipes[randomIndex];
    displayRecipeDetails(randomRecipe.id);
}

// --- SEARCH FUNCTIONS (LIVE MULTI-FIELD SEARCH) ---
function toggleSearchInput(forceOpen) {
    const searchInput = document.getElementById('search-input');
    const header = document.getElementById('main-header');
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !header.classList.contains('search-active');

    if (shouldOpen) {
        header.classList.add('search-active');
        setActiveBottomNav('search');
        setTimeout(() => searchInput.focus(), 20);
    } else {
        header.classList.remove('search-active');
    }
}

function clearSearchBar() {
    const searchInput = document.getElementById('search-input');
    const searchClearBtn = document.getElementById('search-clear-btn');
    const header = document.getElementById('main-header');

    if (searchInput) searchInput.value = '';
    if (searchClearBtn) searchClearBtn.classList.add('hidden');
    if (header) header.classList.remove('search-active');
}

function filterRecipesByQuery(queryStr) {
    const q = queryStr.toLowerCase();
    let matched = appState.allRecipes.filter(recipe => {
        const inTitle = (recipe.title || '').toLowerCase().includes(q);
        const inIngredients = (recipe.ingredients || '').toLowerCase().includes(q);
        const inTags = (recipe.tags || []).some(t => t.toLowerCase().includes(q));
        return inTitle || inIngredients || inTags;
    });
    if (appState.isGoogleUser && appState.showOnlyOwnRecipes) {
        matched = matched.filter(recipe => recipe.userId === appState.currentUserId);
    }
    return matched;
}

function handleLiveSearch(event) {
    const searchTerm = event.target.value.trim();
    const searchClearBtn = document.getElementById('search-clear-btn');

    if (searchClearBtn) {
        searchClearBtn.classList.toggle('hidden', searchTerm.length === 0);
    }

    if (searchTerm.length > 0) {
        setActiveBottomNav('search');
        const matchedRecipes = filterRecipesByQuery(searchTerm);
        displaySearchResults(matchedRecipes, searchTerm);
    } else {
        displayTags();
    }
}

function handleSearch(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        const searchTerm = event.target.value.trim();
        if (searchTerm) {
            const matchedRecipes = filterRecipesByQuery(searchTerm);
            displaySearchResults(matchedRecipes, searchTerm);
            event.target.blur();
        } else {
            clearSearchBar();
            displayTags();
        }
    } else if (event.key === 'Escape') {
        clearSearchBar();
        displayTags();
    }
}

function displaySearchResults(recipes, searchTerm) {
    const container = document.getElementById('search-results-container');
    container.innerHTML = '';

    const viewHeader = document.createElement('div');
    viewHeader.className = 'view-header';

    const leftWrap = document.createElement('div');
    leftWrap.className = 'view-header-left';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'back-pill-btn';
    backBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        Clear
    `;
    backBtn.addEventListener('click', () => {
        clearSearchBar();
        displayTags();
    });

    const header = document.createElement('h2');
    header.className = 'view-title';
    header.textContent = `Results for "${searchTerm}"`;

    leftWrap.appendChild(backBtn);
    leftWrap.appendChild(header);

    const countBadge = document.createElement('span');
    countBadge.className = 'count-badge';
    countBadge.textContent = `${recipes.length} match${recipes.length === 1 ? '' : 'es'}`;

    viewHeader.appendChild(leftWrap);
    viewHeader.appendChild(countBadge);
    container.appendChild(viewHeader);

    if (recipes.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No recipes matched your search.';
        container.appendChild(empty);
    } else {
        const listDiv = document.createElement('div');
        listDiv.id = 'search-results-list';
        recipes.forEach(recipe => {
            listDiv.appendChild(createRecipeCardElement(recipe));
        });
        container.appendChild(listDiv);
    }
    showView('search-results-container');
}

// --- FORM & DATA ACTIONS ---
function showAddRecipeForm(updateUrl = true) {
    if (!appState.isGoogleUser) {
        showNotification("Permission denied: Google sign in required.");
        return;
    }
    if (updateUrl) {
        history.pushState({ view: 'addForm' }, '', '/add');
    }
    document.getElementById('recipe-form').removeAttribute('data-editing-id');
    const modeTitle = document.getElementById('form-mode-title');
    if (modeTitle) {
        modeTitle.textContent = 'Add a New Recipe';
        modeTitle.classList.remove('hidden');
    }
    const cancelLabel = document.getElementById('form-cancel-label');
    if (cancelLabel) cancelLabel.textContent = 'Cancel';
    document.getElementById('recipe-form').reset();
    document.getElementById('save-button').textContent = 'Save Recipe';
    showView('recipe-form-container');
}

function showEditRecipeForm(recipeId, updateUrl = true) {
    if (!appState.isGoogleUser) {
        showNotification("Permission denied: Google sign in required.");
        return;
    }
    if (updateUrl) {
        history.pushState({ view: 'editForm', recipeId }, '', `/edit/${recipeId}`);
    }
    const recipe = appState.allRecipes.find(r => r.id === recipeId);
    if (!recipe) {
        showNotification("Recipe not found.");
        router();
        return;
    }

    document.getElementById('recipe-form').setAttribute('data-editing-id', recipeId);
    const modeTitle = document.getElementById('form-mode-title');
    if (modeTitle) {
        modeTitle.classList.add('hidden');
    }
    const cancelLabel = document.getElementById('form-cancel-label');
    if (cancelLabel) cancelLabel.textContent = 'Cancel Edit';
    document.getElementById('recipe-title').value = recipe.title;
    document.getElementById('recipe-tags').value = (recipe.tags || []).join(', ');
    document.getElementById('recipe-ingredients').value = recipe.ingredients;
    document.getElementById('recipe-instructions').value = recipe.instructions;
    document.getElementById('save-button').textContent = 'Update Recipe';
    showView('recipe-form-container');
}

async function handleFormSubmit(event) {
    event.preventDefault();
    if (!appState.isGoogleUser) {
        showNotification("You must be signed in with a Google account to save recipes.");
        return;
    }

    const form = document.getElementById('recipe-form');
    const recipeId = form.getAttribute('data-editing-id');
    const formattedTitle = toTitleCase(document.getElementById('recipe-title').value.trim());

    const isDuplicate = appState.allRecipes.some(recipe => {
        if (recipeId) {
            return recipe.title.toLowerCase() === formattedTitle.toLowerCase() && recipe.id !== recipeId;
        }
        return recipe.title.toLowerCase() === formattedTitle.toLowerCase();
    });

    if (isDuplicate) {
        showNotification('A recipe with this title already exists. Please choose a unique title.');
        return;
    }
    try {
        const recipesCollection = getSharedRecipesCollection();
        let savedRecipeId = recipeId;
        if (recipeId) {
            const updateData = {
                title: formattedTitle,
                tags: document.getElementById('recipe-tags').value
                    .split(',')
                    .map(tag => toTitleCase(tag.trim()))
                    .filter(tag => tag),
                ingredients: document.getElementById('recipe-ingredients').value,
                instructions: document.getElementById('recipe-instructions').value
            };
            const recipeRef = doc(recipesCollection, recipeId);
            await updateDoc(recipeRef, updateData);
            await logActivity("update", recipeId, formattedTitle);
        } else {
            const recipeData = {
                title: formattedTitle,
                tags: document.getElementById('recipe-tags').value
                    .split(',')
                    .map(tag => toTitleCase(tag.trim()))
                    .filter(tag => tag),
                ingredients: document.getElementById('recipe-ingredients').value,
                instructions: document.getElementById('recipe-instructions').value,
                userId: appState.currentUserId,
                author: appState.currentUserEmail,
                createdAt: serverTimestamp()
            };
            const docRef = await addDoc(recipesCollection, recipeData);
            savedRecipeId = docRef.id;
            await logActivity("create", savedRecipeId, formattedTitle);
        }
        showNotification('Recipe saved successfully!');
        displayRecipeDetails(savedRecipeId, true);

    } catch (error) {
        console.error("Error saving recipe: ", error);
        showNotification("Error: Could not save the recipe.");
    }
}

function confirmDelete(recipeId, recipeTitle) {
    const modal = document.getElementById('custom-modal');
    const modalMessage = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    modalMessage.textContent = `Do you really want to delete "${recipeTitle}"? This action cannot be undone.`;
    modal.classList.remove('hidden');

    const confirmHandler = async () => {
        await deleteRecipe(recipeId);
        closeModal();
    };

    const cancelHandler = () => {
        closeModal();
    };

    const closeModal = () => {
        modal.classList.add('hidden');
        confirmBtn.removeEventListener('click', confirmHandler);
        cancelBtn.removeEventListener('click', cancelHandler);
    };

    confirmBtn.addEventListener('click', confirmHandler);
    cancelBtn.addEventListener('click', cancelHandler);
}

async function deleteRecipe(id) {
    if (!appState.isGoogleUser) {
        showNotification("Permission denied: Google sign in required.");
        return;
    }

    const recipe = appState.allRecipes.find(r => r.id === id);
    const title = recipe ? recipe.title : "Recipe";

    try {
        await deleteDoc(doc(getSharedRecipesCollection(), id));
        await logActivity("delete", id, title);
        showNotification('Recipe deleted.');
        displayTags(true);
    } catch (error) {
        console.error("Error deleting recipe: ", error);
        showNotification("Error: Could not delete the recipe.");
    }
}
