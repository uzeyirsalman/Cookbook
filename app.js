import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signInAnonymously, 
    signInWithCustomToken,
    signInWithPopup,
    GoogleAuthProvider,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
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
const db = getFirestore(app);

// --- STATE MANAGEMENT ---
let appState = {
    currentUserId: null,
    currentUserEmail: null,
    isGoogleUser: false,
    showOnlyOwnRecipes: false, // Tracks whether the user is filtering only their own recipes
    allRecipes: [],
    unsubscribeFromRecipes: null,
    unsubscribeFromLogs: null
};

window.exportData = appState; // Enable downloading

// --- INITIALIZATION & AUTH ---
document.addEventListener('DOMContentLoaded', () => {
    handleAuthentication();
    setupScrollListener(); // Initialize the scroll logic
    window.addEventListener('popstate', router);
});

// --- SCROLL LOGIC FOR HEADER ---
function setupScrollListener() {
    let lastScrollTop = 0;
    const header = document.getElementById('main-header');
    
    window.addEventListener('scroll', () => {
        let scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        
        // Prevent negative scrolling (bounce effects)
        if (scrollTop <= 0) {
            header.classList.remove('header-hidden');
            lastScrollTop = 0;
            return;
        }

        // If scrolling down AND past the header height
        if (scrollTop > lastScrollTop && scrollTop > header.offsetHeight) {
            header.classList.add('header-hidden');
            // Ensure search is closed when scrolling down so it doesn't float weirdly
            if (header.classList.contains('search-active')) {
                toggleSearchInput(); 
            }
        } else {
            // Scrolling up
            header.classList.remove('header-hidden');
        }
        
        lastScrollTop = scrollTop;
    });
}

function handleAuthentication() {
    onAuthStateChanged(auth, async (user) => {
        if (user && !user.isAnonymous) {
            // Google Authenticated User (Author)
            appState.currentUserId = user.uid;
            appState.currentUserEmail = user.email || "Google User";
            appState.isGoogleUser = true;

            // UI updates: Dynamic user header section inside drawer
            const userSection = document.getElementById('drawer-user-section');
            if (userSection) {
                userSection.classList.remove('hidden');
                const userPhoto = user.photoURL || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z' fill='%236c757d'/%3E%3C/svg%3E";
                userSection.innerHTML = `
                    <img class="user-avatar" src="${userPhoto}" alt="User Avatar" referrerpolicy="no-referrer">
                    <div class="drawer-user-info">
                        <span class="drawer-user-name">${user.displayName || "Google User"}</span>
                        <span class="drawer-user-email">${user.email}</span>
                    </div>
                `;
            }

            // Auth UI: Toggle drawer buttons
            document.getElementById('drawer-login-btn').classList.add('hidden');
            document.getElementById('drawer-logout-btn').classList.remove('hidden');
            
            // Show author-specific drawer menu actions
            document.getElementById('menu-add-recipe-row').classList.remove('hidden');
            document.getElementById('drawer-filter-section').classList.remove('hidden');
            const filterCheckbox = document.getElementById('own-recipes-filter');
            if (filterCheckbox) {
                filterCheckbox.checked = appState.showOnlyOwnRecipes;
            }

            // Settings gear & Log Listener EXCLUSIVE to Admin
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

            // Run author migration to uzeyirsalman@gmail.com
            await migrateExistingRecipes();

            listenForRecipes(router);
        } else {
            // Guest User (anonymous or logged out)
            appState.currentUserId = user ? user.uid : null;
            appState.currentUserEmail = "Guest";
            appState.isGoogleUser = false;
            appState.showOnlyOwnRecipes = false; // Reset filter

            // UI updates: Dynamic user section (clear & hide)
            const userSection = document.getElementById('drawer-user-section');
            if (userSection) {
                userSection.innerHTML = '';
                userSection.classList.add('hidden');
            }

            // Auth UI: Toggle drawer buttons
            document.getElementById('drawer-login-btn').classList.remove('hidden');
            document.getElementById('drawer-logout-btn').classList.add('hidden');
            
            // Hide author-specific drawer menu actions
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
    console.log("Binding click listeners to DOM elements...");

    document.getElementById('home-btn').addEventListener('click', () => displayTags());
    document.getElementById('recipe-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('search-btn').addEventListener('click', toggleSearchInput);
    document.getElementById('search-input').addEventListener('keydown', handleSearch);

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

    // Drawer Menu Actions (Dismisses drawer after click)
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

    // "My Recipes Only" filter checkbox listener (inside drawer)
    const filterCheckbox = document.getElementById('own-recipes-filter');
    if (filterCheckbox) {
        filterCheckbox.addEventListener('change', (e) => {
            appState.showOnlyOwnRecipes = e.target.checked;
            
            // Re-render the active view instantly by calling router
            router();
        });
    }
}

// --- GOOGLE AUTHENTICATION ACTIONS ---
async function handleGoogleSignIn() {
    console.log("handleGoogleSignIn triggered by click!");
    const provider = new GoogleAuthProvider();
    try {
        console.log("Launching Firebase signInWithPopup...");
        const result = await signInWithPopup(auth, provider);
        console.log("Sign in success! User:", result.user.email);
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
        router(); // Re-route to trigger redirect if on edit/add page
    } catch (error) {
        console.error("Sign out failed:", error);
        showNotification("Failed to sign out.");
    }
}

// --- ONE-TIME AUTHOR MIGRATION ---
async function migrateExistingRecipes() {
    if (!appState.isGoogleUser) return;

    // Check if already completed in LocalStorage to optimize clients
    if (localStorage.getItem('cookbook_migrated_author_2026') === 'true') return;

    const recipesToMigrate = appState.allRecipes.filter(r => !r.author || r.author === 'system');

    if (recipesToMigrate.length === 0) {
        localStorage.setItem('cookbook_migrated_author_2026', 'true');
        return;
    }

    console.log(`Migrating ${recipesToMigrate.length} recipes to author uzeyirsalman@gmail.com...`);
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
        console.log(`Database migrated: ${migrateCount} recipes updated.`);
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
            action: action, // "create", "update", "delete", "import", "migrate"
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
            listDiv.innerHTML = `<div style="color: var(--secondary-text); text-align: center; padding: 0.5rem;">No activity logged yet.</div>`;
            return;
        }

        snapshot.docs.forEach(doc => {
            const log = doc.data();
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
        listDiv.innerHTML = `<div style="color: var(--danger); text-align: center; padding: 0.5rem;">Log permission denied.</div>`;
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

// Ensure non-admins cannot access settings modal
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

    // Only Google Auth admin can write/import recipes
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
                statusDiv.textContent = `Import completed! Added: ${successCount}, Restored/Updated: ${duplicateCount}, Errors: ${errorCount}`;
            }
            showNotification("Recipes imported successfully!");

            // Log this import action
            if (successCount > 0 || duplicateCount > 0) {
                await logActivity("import", "backup_file", `Imported ${successCount + duplicateCount} backup recipes`);
            }

            event.target.value = ''; // Reset file input
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

    // Enforce Route Protection: guests cannot view add/edit forms
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

        appState.allRecipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
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
    ['tag-list-container', 'recipe-list-container', 'recipe-detail-container', 'recipe-form-container', 'search-results-container'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    
    const viewToShow = document.getElementById(viewId);
    if(viewToShow) {
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

function getCategoryIcon(tag) {
    const clean = tag.toLowerCase().trim();
    if (clean.includes('pasta') || clean.includes('italian') || clean.includes('noodle')) {
        return `<svg viewBox="0 0 100 100" class="shadow-filter">
            <defs>
                <linearGradient id="crust-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#fbbf24" />
                    <stop offset="100%" stop-color="#b45309" />
                </linearGradient>
                <linearGradient id="cheese-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#fef08a" />
                    <stop offset="100%" stop-color="#eab308" />
                </linearGradient>
                <linearGradient id="sauce-grad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#f87171" />
                    <stop offset="100%" stop-color="#b91c1c" />
                </linearGradient>
            </defs>
            <path d="M 50 15 C 60 15, 78 20, 82 25 C 80 32, 60 78, 50 88 C 40 78, 20 32, 18 25 C 22 20, 40 15, 50 15 Z" fill="url(#crust-grad)" />
            <path d="M 50 20 C 58 20, 72 24, 76 28 L 50 82 L 24 28 C 28 24, 42 20, 50 20 Z" fill="url(#sauce-grad)" />
            <path d="M 50 23 C 56 23, 68 27, 72 32 C 65 42, 64 54, 52 70 Q 50 74 48 70 C 36 54, 35 42, 28 32 C 32 27, 44 23, 50 23 Z" fill="url(#cheese-grad)" />
            <circle cx="40" cy="38" r="7" fill="#dc2626" />
            <circle cx="60" cy="45" r="7" fill="#dc2626" />
            <circle cx="50" cy="60" r="5" fill="#dc2626" />
            <path d="M 45 48 Q 48 42 52 48 Q 50 54 45 48 Z" fill="#10b981" />
        </svg>`;
    }
    if (clean.includes('sandwich')) {
        return `<svg viewBox="0 0 100 100" class="shadow-filter">
            <defs>
                <linearGradient id="crust-s-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#d97706" />
                    <stop offset="100%" stop-color="#78350f" />
                </linearGradient>
                <linearGradient id="crumb-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#fef3c7" />
                    <stop offset="100%" stop-color="#fde68a" />
                </linearGradient>
            </defs>
            <path d="M 15 65 L 75 25 L 85 75 Z" fill="url(#crust-s-grad)" />
            <path d="M 18 63 L 73 27 L 82 72 Z" fill="url(#crumb-grad)" />
            <path d="M 22 65 L 75 30 L 80 68 Z" fill="#fda4af" />
            <path d="M 26 67 Q 30 75 34 65 L 75 32 L 78 64 Z" fill="#fbbf24" />
            <path d="M 20 63 Q 15 68 25 61 L 72 27 L 76 60 Z" fill="#4ade80" stroke="#22c55e" stroke-width="2" />
            <polygon points="38,55 58,42 62,56" fill="#f87171" />
            <path d="M 25 75 L 85 35 L 85 75 Z" fill="url(#crust-s-grad)" />
            <path d="M 28 73 L 82 37 L 82 73 Z" fill="url(#crumb-grad)" />
            <line x1="55" y1="18" x2="55" y2="48" stroke="#cbd5e1" stroke-width="2" />
            <circle cx="55" cy="18" r="6" fill="#15803d" />
            <circle cx="55" cy="18" r="2.5" fill="#ef4444" />
        </svg>`;
    }
    if (clean.includes('dessert') || clean.includes('sweet') || clean.includes('cake') || clean.includes('cookie') || clean.includes('bake')) {
        return `<svg viewBox="0 0 100 100" class="shadow-filter">
            <defs>
                <linearGradient id="liner-g" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stop-color="#fef08a" />
                    <stop offset="100%" stop-color="#ca8a04" />
                </linearGradient>
                <linearGradient id="frost-g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#fce7f3" />
                    <stop offset="100%" stop-color="#ec4899" />
                </linearGradient>
                <linearGradient id="berry-g" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#f43f5e" />
                    <stop offset="100%" stop-color="#9f1239" />
                </linearGradient>
            </defs>
            <ellipse cx="50" cy="74" rx="40" ry="12" fill="#e2e8f0" />
            <path d="M 28 50 L 34 74 Q 50 78 66 74 L 72 50 Z" fill="url(#liner-g)" />
            <line x1="38" y1="52" x2="42" y2="74" stroke="#ca8a04" stroke-width="2" />
            <line x1="50" y1="53" x2="50" y2="75" stroke="#ca8a04" stroke-width="2" />
            <line x1="62" y1="52" x2="58" y2="74" stroke="#ca8a04" stroke-width="2" />
            <path d="M 22 52 C 22 42, 78 42, 78 52 C 78 60, 22 60, 22 52 Z" fill="url(#frost-g)" />
            <path d="M 28 44 C 28 36, 72 36, 72 44 C 72 50, 28 50, 28 44 Z" fill="url(#frost-g)" opacity="0.9" />
            <path d="M 36 36 C 36 28, 64 28, 64 36 C 64 41, 36 41, 36 36 Z" fill="url(#frost-g)" opacity="0.8" />
            <path d="M 50 20 C 46 20, 44 26, 50 32 C 56 26, 54 20, 50 20 Z" fill="url(#berry-g)" />
            <circle cx="48" cy="24" r="0.5" fill="#fef08a" />
            <circle cx="52" cy="24" r="0.5" fill="#fef08a" />
            <circle cx="50" cy="27" r="0.5" fill="#fef08a" />
        </svg>`;
    }
    if (clean.includes('soup') || clean.includes('stew') || clean.includes('ramen')) {
        return `<svg viewBox="0 0 100 100" class="shadow-filter">
            <defs>
                <linearGradient id="soup-bowl-g-soup" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#a7f3d0" />
                    <stop offset="100%" stop-color="#047857" />
                </linearGradient>
                <linearGradient id="tomato-soup-soup" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#f87171" />
                    <stop offset="100%" stop-color="#ea580c" />
                </linearGradient>
            </defs>
            <ellipse cx="46" cy="72" rx="36" ry="12" fill="#e2e8f0" />
            <path d="M 16 48 Q 46 60 76 48 C 76 68 64 80 46 80 C 28 80 16 68 16 48 Z" fill="url(#soup-bowl-g-soup)" />
            <ellipse cx="46" cy="48" rx="28" ry="9" fill="url(#tomato-soup-soup)" />
            <path d="M 40 47 Q 46 44 52 47 Q 46 51 40 47 Z" fill="#ffffff" opacity="0.85" />
            <circle cx="36" cy="46" r="3.5" fill="#10b981" />
            <circle cx="48" cy="45" r="3" fill="#10b981" />
            <line x1="24" y1="36" x2="10" y2="22" stroke="#cbd5e1" stroke-width="4.5" stroke-linecap="round" />
        </svg>`;
    }
    if (clean.includes('asian') || clean.includes('chinese') || clean.includes('japanese') || clean.includes('korean') || clean.includes('thai')) {
        return `<svg viewBox="0 0 100 100" class="shadow-filter">
            <defs>
                <linearGradient id="salmon-g-asian" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#fb923c" />
                    <stop offset="100%" stop-color="#ea580c" />
                </linearGradient>
                <linearGradient id="rice-g-asian" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#ffffff" />
                    <stop offset="100%" stop-color="#e2e8f0" />
                </linearGradient>
                <linearGradient id="bun-g-asian" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#ffffff" />
                    <stop offset="100%" stop-color="#f1f5f9" />
                </linearGradient>
            </defs>
            <ellipse cx="50" cy="72" rx="42" ry="12" fill="#d1e7dd" opacity="0.6" />
            <g transform="translate(14, 28)">
                <ellipse cx="20" cy="38" rx="16" ry="6" fill="#cbd5e1" opacity="0.6" />
                <path d="M 6 34 C 4 34, 2 24, 20 18 C 38 24, 36 34, 34 34 C 32 38, 8 38, 6 34 Z" fill="url(#bun-g-asian)" stroke="#cbd5e1" stroke-width="1.5" />
                <path d="M 20 18 C 16 26, 14 30, 10 34" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" />
                <path d="M 20 18 C 20 26, 20 30, 20 35" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" />
                <path d="M 20 18 C 24 26, 26 30, 30 34" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" />
                <circle cx="20" cy="18" r="2.5" fill="#f87171" />
            </g>
            <g transform="translate(48, 40) rotate(5)">
                <ellipse cx="20" cy="30" rx="18" ry="6" fill="#cbd5e1" opacity="0.6" />
                <rect x="8" y="16" width="24" height="12" rx="6" fill="url(#rice-g-asian)" />
                <rect x="4" y="10" width="32" height="12" rx="5" fill="url(#salmon-g-asian)" />
                <path d="M 12 10 L 18 22" fill="none" stroke="#fed7aa" stroke-width="2" stroke-linecap="round" />
                <path d="M 20 10 L 26 22" fill="none" stroke="#fed7aa" stroke-width="2" stroke-linecap="round" />
                <rect x="18" y="10" width="5" height="17" fill="#1e293b" />
            </g>
        </svg>`;
    }
    if (clean.includes('salad') || clean.includes('green')) {
        return `<svg viewBox="0 0 100 100" class="shadow-filter">
            <defs>
                <linearGradient id="salad-bowl-g-salad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#334155" />
                    <stop offset="100%" stop-color="#0f172a" />
                </linearGradient>
                <linearGradient id="salad-bowl-rim-salad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#64748b" />
                    <stop offset="100%" stop-color="#334155" />
                </linearGradient>
                <linearGradient id="green-leaf-1-salad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#4ade80" />
                    <stop offset="100%" stop-color="#15803d" />
                </linearGradient>
                <linearGradient id="green-leaf-2-salad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#22c55e" />
                    <stop offset="100%" stop-color="#14532d" />
                </linearGradient>
                <radialGradient id="tom-pulp-salad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#ef4444" />
                    <stop offset="85%" stop-color="#b91c1c" />
                    <stop offset="100%" stop-color="#7f1d1d" />
                </radialGradient>
                <linearGradient id="cuc-ring-salad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#22c55e" />
                    <stop offset="100%" stop-color="#166534" />
                </linearGradient>
            </defs>
            <ellipse cx="50" cy="76" rx="44" ry="12" fill="#0f172a" opacity="0.3" />
            <path d="M 12 50 Q 50 64 88 50 C 88 72 70 86 50 86 C 30 86 12 72 12 50 Z" fill="url(#salad-bowl-g-salad)" />
            <ellipse cx="50" cy="50" rx="38" ry="10" fill="url(#salad-bowl-rim-salad)" />
            <ellipse cx="50" cy="49" rx="36" ry="9" fill="#1e293b" />
            <path d="M 18 45 C 14 36, 32 30, 36 38 C 42 32, 54 30, 56 38 C 66 32, 82 36, 78 46 C 70 54, 30 54, 18 45 Z" fill="url(#green-leaf-2-salad)" />
            <path d="M 28 39 Q 34 33 38 41" fill="none" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" />
            <path d="M 48 35 Q 54 31 58 40" fill="none" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" />
            <path d="M 64 36 Q 72 32 74 42" fill="none" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" />
            <g transform="translate(26, 43) rotate(-15)">
                <circle cx="10" cy="10" r="10" fill="#dc2626" />
                <circle cx="10" cy="10" r="8.5" fill="url(#tom-pulp-salad)" />
                <path d="M 10 3 L 10 17 M 3 10 L 17 10" stroke="#f87171" stroke-width="1" opacity="0.6" />
                <circle cx="7" cy="7" r="0.8" fill="#fbbf24" />
                <circle cx="13" cy="7" r="0.8" fill="#fbbf24" />
                <circle cx="7" cy="13" r="0.8" fill="#fbbf24" />
                <circle cx="13" cy="13" r="0.8" fill="#fbbf24" />
                <path d="M 5 6 A 6 6 0 0 1 9 4" fill="none" stroke="#ffffff" stroke-width="1" stroke-linecap="round" opacity="0.6" />
            </g>
            <g transform="translate(54, 46) rotate(20)">
                <circle cx="10" cy="10" r="10" fill="#dc2626" />
                <circle cx="10" cy="10" r="8.5" fill="url(#tom-pulp-salad)" />
                <path d="M 10 3 L 10 17 M 3 10 L 17 10" stroke="#f87171" stroke-width="1" opacity="0.6" />
                <circle cx="7" cy="7" r="0.8" fill="#fbbf24" />
                <circle cx="13" cy="7" r="0.8" fill="#fbbf24" />
                <circle cx="7" cy="13" r="0.8" fill="#fbbf24" />
                <path d="M 5 6 A 6 6 0 0 1 9 4" fill="none" stroke="#ffffff" stroke-width="1" stroke-linecap="round" opacity="0.6" />
            </g>
            <g transform="translate(42, 40) rotate(-5)">
                <circle cx="8" cy="8" r="9" fill="url(#cuc-ring-salad)" />
                <circle cx="8" cy="8" r="7.5" fill="#dcfce7" />
                <circle cx="8" cy="8" r="5" fill="none" stroke="#bbf7d0" stroke-width="1" stroke-dasharray="2,1" />
                <circle cx="6" cy="6" r="0.6" fill="#166534" />
                <circle cx="10" cy="6" r="0.6" fill="#166534" />
                <circle cx="6" cy="10" r="0.6" fill="#166534" />
                <circle cx="10" cy="10" r="0.6" fill="#166534" />
                <path d="M 2 4 A 7 7 0 0 1 6 2" fill="none" stroke="#86efac" stroke-width="0.8" opacity="0.7" />
            </g>
            <ellipse cx="50" cy="52" rx="14" ry="4.5" fill="none" stroke="#c084fc" stroke-width="1.8" transform="rotate(-12, 50, 52)" opacity="0.8" />
            <ellipse cx="50" cy="52" rx="12" ry="3.5" fill="none" stroke="#f3e8ff" stroke-width="0.8" transform="rotate(-12, 50, 52)" opacity="0.9" />
            <ellipse cx="38" cy="55" rx="11" ry="3" fill="none" stroke="#c084fc" stroke-width="1.5" transform="rotate(18, 38, 55)" opacity="0.7" />
            <ellipse cx="38" cy="55" rx="9" ry="2.2" fill="none" stroke="#f3e8ff" stroke-width="0.7" transform="rotate(18, 38, 55)" opacity="0.8" />
            <g transform="translate(62, 38)">
                <ellipse cx="4" cy="4" rx="3.5" ry="4.5" fill="#1e293b" transform="rotate(15, 4, 4)" />
                <ellipse cx="4" cy="4" rx="1.2" ry="1.8" fill="#475569" />
                <circle cx="3" cy="2.5" r="0.6" fill="#ffffff" opacity="0.8" />
            </g>
            <g transform="translate(18, 52) rotate(-8)">
                <path d="M 2 10 C 6 4, 18 4, 22 10 L 16 11 C 13 7, 7 7, 4 11 Z" fill="#15803d" />
                <path d="M 3 10 C 7 5, 17 5, 21 10 L 16 11 C 13 8, 8 8, 5 11 Z" fill="#84cc16" />
                <path d="M 4 10 C 8 6, 16 6, 20 10 L 16 11 C 13 9, 9 9, 6 11 Z" fill="#d9f99d" />
            </g>
        </svg>`;
    }
    if (clean.includes('azeri') || clean.includes('plov') || clean.includes('azerbaijan')) {
        return `<svg viewBox="0 0 100 100" class="shadow-filter">
            <defs>
                <linearGradient id="crust-lavash-azeri" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#fef08a" />
                    <stop offset="50%" stop-color="#d97706" />
                    <stop offset="100%" stop-color="#78350f" />
                </linearGradient>
                <radialGradient id="rice-saffron-azeri" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#fef08a" />
                    <stop offset="70%" stop-color="#fbbf24" />
                    <stop offset="100%" stop-color="#d97706" />
                </radialGradient>
                <linearGradient id="dried-apricot-azeri" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#f97316" />
                    <stop offset="100%" stop-color="#9a3412" />
                </linearGradient>
                <radialGradient id="prune-glossy-azeri" cx="30%" cy="30%" r="70%">
                    <stop offset="0%" stop-color="#4a044e" />
                    <stop offset="60%" stop-color="#1e1b4b" />
                    <stop offset="100%" stop-color="#030712" />
                </radialGradient>
                <linearGradient id="chestnut-azeri" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#78350f" />
                    <stop offset="100%" stop-color="#451a03" />
                </linearGradient>
            </defs>
            <!-- Soft Ground Ambient Shadow directly under the food -->
            <ellipse cx="50" cy="74" rx="35" ry="6" fill="#78350f" opacity="0.3" />
            <ellipse cx="50" cy="74" rx="26" ry="3.5" fill="#451a03" opacity="0.2" />
            
            <!-- Main Plov Body Structure (The Drum Shape) -->
            <path d="M 20 66 C 20 54, 24 50, 50 50 C 76 50, 80 54, 80 66 C 80 74, 76 76, 50 76 C 24 76, 20 74, 20 66 Z" fill="url(#crust-lavash-azeri)" />
            <!-- Overlapping lavash crust folds/details -->
            <path d="M 20 66 C 22 55, 34 50, 36 68" fill="none" stroke="#451a03" stroke-width="0.8" opacity="0.25" />
            <path d="M 35 68 C 38 53, 50 50, 52 70" fill="none" stroke="#451a03" stroke-width="0.8" opacity="0.25" />
            <path d="M 50 70 C 53 53, 65 50, 68 68" fill="none" stroke="#451a03" stroke-width="0.8" opacity="0.25" />
            <path d="M 66 68 C 68 55, 78 55, 80 66" fill="none" stroke="#451a03" stroke-width="0.8" opacity="0.25" />

            <!-- Cut-Open Floral Petals Opening Outward -->
            <!-- Petal Left -->
            <path d="M 20 54 C 20 42, 10 40, 24 44 Z" fill="url(#crust-lavash-azeri)" stroke="#78350f" stroke-width="0.5" />
            <path d="M 22 51 C 21 44, 15 42, 24 45" fill="none" stroke="#fef08a" stroke-width="0.8" opacity="0.5" />
            <!-- Petal Right -->
            <path d="M 80 54 C 80 42, 90 40, 76 44 Z" fill="url(#crust-lavash-azeri)" stroke="#78350f" stroke-width="0.5" />
            <path d="M 78 51 C 79 44, 85 42, 76 45" fill="none" stroke="#fef08a" stroke-width="0.8" opacity="0.5" />
            <!-- Petal Front Left -->
            <path d="M 28 50 C 26 38, 28 32, 40 45 Z" fill="url(#crust-lavash-azeri)" stroke="#78350f" stroke-width="0.5" />
            <path d="M 30 48 C 29 40, 31 36, 38 45" fill="none" stroke="#fef08a" stroke-width="0.8" opacity="0.5" />
            <!-- Petal Front Right -->
            <path d="M 72 50 C 74 38, 72 32, 60 45 Z" fill="url(#crust-lavash-azeri)" stroke="#78350f" stroke-width="0.5" />
            <path d="M 70 48 C 71 40, 69 36, 62 45" fill="none" stroke="#fef08a" stroke-width="0.8" opacity="0.5" />
            <!-- Petal Back Center -->
            <path d="M 44 48 C 46 32, 54 32, 56 48 Z" fill="url(#crust-lavash-azeri)" stroke="#78350f" stroke-width="0.5" />

            <!-- Inner Saffron Rice Dome -->
            <ellipse cx="50" cy="53" rx="27" ry="12" fill="url(#rice-saffron-azeri)" />
            <!-- Rice grains texture -->
            <ellipse cx="50" cy="53" rx="25" ry="10" fill="none" stroke="#fef08a" stroke-dasharray="1.5,1.5" stroke-width="1.2" opacity="0.65" />
            <ellipse cx="50" cy="53" rx="21" ry="8" fill="none" stroke="#ffffff" stroke-dasharray="1,2" stroke-width="1" opacity="0.8" />
            <ellipse cx="50" cy="53" rx="16" ry="6" fill="none" stroke="#eab308" stroke-dasharray="2,1" stroke-width="1" opacity="0.5" />

            <!-- Chestnuts, Dried Fruits Nestled in Saffron Rice -->
            <!-- Prunes (Glossy dark purple/black) -->
            <g transform="translate(38, 48)">
                <ellipse cx="4" cy="4" rx="3.5" ry="2.5" fill="url(#prune-glossy-azeri)" transform="rotate(-15, 4, 4)" />
                <circle cx="3" cy="3" r="0.6" fill="#ffffff" opacity="0.8" />
            </g>
            <g transform="translate(56, 50)">
                <ellipse cx="4" cy="4" rx="3" ry="2.2" fill="url(#prune-glossy-azeri)" transform="rotate(35, 4, 4)" />
                <circle cx="3" cy="3" r="0.5" fill="#ffffff" opacity="0.8" />
            </g>
            <!-- Dried Apricots (Vibrant orange/brown) -->
            <g transform="translate(45, 52)">
                <ellipse cx="5" cy="4" rx="4" ry="2.8" fill="url(#dried-apricot-azeri)" transform="rotate(10, 5, 4)" />
                <ellipse cx="4.5" cy="3.5" rx="2.5" ry="1.5" fill="#fb923c" opacity="0.6" />
                <path d="M 2 4 A 4 4 0 0 1 5 2" fill="none" stroke="#ffffff" stroke-width="0.6" opacity="0.4" />
            </g>
            <g transform="translate(32, 51)">
                <ellipse cx="4.5" cy="4.2" rx="3.8" ry="2.5" fill="url(#dried-apricot-azeri)" transform="rotate(-40, 4.5, 4.2)" />
                <ellipse cx="4" cy="3.8" rx="2.2" ry="1.2" fill="#fb923c" opacity="0.6" />
            </g>
            <g transform="translate(60, 47)">
                <ellipse cx="4.5" cy="4.2" rx="3.8" ry="2.5" fill="url(#dried-apricot-azeri)" transform="rotate(50, 4.5, 4.2)" />
                <ellipse cx="4" cy="3.8" rx="2.2" ry="1.2" fill="#fb923c" opacity="0.6" />
            </g>
            <!-- Chestnuts (Deep chestnut brown) -->
            <g transform="translate(48, 45)">
                <path d="M 1 4 C 1 1, 6 1, 6 4 C 6 6, 4 7, 3 7 C 2 7, 1 6, 1 4 Z" fill="url(#chestnut-azeri)" transform="rotate(15, 3.5, 4)" />
                <circle cx="2.5" cy="2.5" r="0.6" fill="#fbbf24" opacity="0.4" />
            </g>
            <g transform="translate(52, 53)">
                <path d="M 1 4 C 1 1, 6 1, 6 4 C 6 6, 4 7, 3 7 C 2 7, 1 6, 1 4 Z" fill="url(#chestnut-azeri)" transform="rotate(-65, 3.5, 4)" />
            </g>
            
            <!-- Barberry/Raisin Speckles -->
            <circle cx="43" cy="47" r="0.7" fill="#ef4444" />
            <circle cx="58" cy="54" r="0.7" fill="#ef4444" />
            <circle cx="37" cy="55" r="0.7" fill="#ef4444" />
            <circle cx="50" cy="50" r="0.8" fill="#1e1b4b" />
            
            <!-- Rising Steam Trails -->
            <path d="M 44 38 Q 42 28 46 20 Q 48 15 46 10" fill="none" stroke="#cbd5e1" stroke-width="1.8" stroke-linecap="round" opacity="0.25" />
            <path d="M 56 36 Q 54 26 58 18" fill="none" stroke="#cbd5e1" stroke-width="1.2" stroke-linecap="round" opacity="0.2" />
        </svg>`;
    }
    if (clean.includes('turkish') || clean.includes('kebab') || clean.includes('shish') || clean.includes('turkey')) {
        return `<svg viewBox="0 0 100 100" class="shadow-filter">
            <defs>
                <linearGradient id="skewer-metal-tr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#cbd5e1" />
                    <stop offset="50%" stop-color="#94a3b8" />
                    <stop offset="100%" stop-color="#475569" />
                </linearGradient>
                <linearGradient id="chicken-marinade-tr" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#fb923c" />
                    <stop offset="35%" stop-color="#f97316" />
                    <stop offset="70%" stop-color="#b45309" />
                    <stop offset="100%" stop-color="#78350f" />
                </linearGradient>
                <linearGradient id="skewer-handle-tr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#d97706" />
                    <stop offset="100%" stop-color="#78350f" />
                </linearGradient>
                <linearGradient id="grilled-tomato-tr" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#ef4444" />
                    <stop offset="70%" stop-color="#b91c1c" />
                    <stop offset="100%" stop-color="#450a0a" />
                </linearGradient>
            </defs>
            <!-- Soft Ambient Floating Ground Shadow directly under the Kebab -->
            <ellipse cx="50" cy="74" rx="35" ry="4.5" fill="#451a03" opacity="0.18" />

            <!-- Skewer Handle -->
            <path d="M 6 86 L 16 76" stroke="url(#skewer-handle-tr)" stroke-width="6.5" stroke-linecap="round" />
            <!-- Skewer Metal Rod -->
            <line x1="12" y1="80" x2="88" y2="12" stroke="url(#skewer-metal-tr)" stroke-width="2.8" stroke-linecap="round" />
            <!-- Glistening Metal Tip -->
            <line x1="82" y1="18" x2="87" y2="13" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round" opacity="0.75" />

            <!-- Grilled Tomato Chunk at the bottom of the skewer -->
            <g transform="translate(18, 59) rotate(15)">
                <ellipse cx="8" cy="8" rx="8" ry="7" fill="url(#grilled-tomato-tr)" />
                <!-- Black Char mark -->
                <ellipse cx="8" cy="8" rx="5" ry="1.8" fill="#1c1917" opacity="0.85" />
                <ellipse cx="8" cy="8" rx="3" ry="0.8" fill="#000000" />
                <path d="M 3 5 Q 8 3 13 6" fill="none" stroke="#fca5a5" stroke-width="0.8" opacity="0.6" />
            </g>

            <!-- Chicken Chunk 1 (Tavuk) -->
            <g transform="translate(28, 48) rotate(-10)">
                <rect x="0" y="0" width="16" height="15" rx="4.5" fill="url(#chicken-marinade-tr)" />
                <!-- Grill Marks -->
                <path d="M 3 5 C 6 4, 10 3, 13 6" stroke="#451a03" stroke-width="2.5" stroke-linecap="round" />
                <path d="M 4 10 C 7 9, 11 8, 14 11" stroke="#451a03" stroke-width="2" stroke-linecap="round" />
                <!-- White Glistening Highlights -->
                <ellipse cx="8" cy="3" rx="4" ry="1" fill="#ffffff" opacity="0.3" />
                <circle cx="5" cy="7" r="0.7" fill="#ffffff" opacity="0.8" />
                <circle cx="11" cy="11" r="0.5" fill="#ffffff" opacity="0.7" />
                <!-- Chili Pepper flake specks -->
                <rect x="12" y="4" width="1.5" height="1.5" rx="0.3" fill="#ef4444" transform="rotate(45, 12, 4)" />
                <circle cx="4" cy="12" r="0.5" fill="#22c55e" />
            </g>

            <!-- Grilled Green Pepper Segment -->
            <g transform="translate(48, 38) rotate(35)">
                <rect x="0" y="0" width="13" height="12" rx="3.5" fill="#166534" />
                <rect x="1.2" y="1.2" width="10.6" height="9.6" rx="2.5" fill="#22c55e" opacity="0.25" />
                <!-- Char bubble -->
                <ellipse cx="6.5" cy="6" rx="4" ry="1.5" fill="#1c1917" opacity="0.8" />
                <ellipse cx="6.5" cy="6" rx="2" ry="0.6" fill="#000000" />
                <path d="M 2 3 A 8 8 0 0 1 11 3" fill="none" stroke="#86efac" stroke-width="0.8" opacity="0.6" />
            </g>

            <!-- Chicken Chunk 2 (Tavuk) -->
            <g transform="translate(56, 26) rotate(15)">
                <rect x="0" y="0" width="16" height="15" rx="4.5" fill="url(#chicken-marinade-tr)" />
                <!-- Grill Marks -->
                <path d="M 3 5 C 6 4, 10 3, 13 6" stroke="#451a03" stroke-width="2.5" stroke-linecap="round" />
                <path d="M 4 10 C 7 9, 11 8, 14 11" stroke="#451a03" stroke-width="2" stroke-linecap="round" />
                <!-- Highlights & Pepper flakes -->
                <circle cx="6" cy="4" r="0.8" fill="#ffffff" opacity="0.8" />
                <rect x="3" y="11" width="1.8" height="1.8" rx="0.5" fill="#ef4444" transform="rotate(15, 3, 11)" />
                <circle cx="12" cy="7" r="0.6" fill="#22c55e" />
            </g>

            <!-- Purple Onion Wedge at the top -->
            <g transform="translate(72, 16) rotate(-25)">
                <path d="M 0 5 C 0 0, 12 0, 12 5 L 8 11 C 6 8, 4 8, 0 5 Z" fill="#7e22ce" />
                <path d="M 1.5 4 C 1.5 1, 10.5 1, 10.5 4 L 7.5 9.5 C 6 7.5, 4.5 7.5, 1.5 4 Z" fill="#c084fc" opacity="0.9" />
                <path d="M 3 3 C 3 1.5, 9 1.5, 9 3 L 7 8 C 6 6.5, 5 6.5, 3 8 Z" fill="#f3e8ff" opacity="0.85" />
                <path d="M 0 5 L 2 11" stroke="#451a03" stroke-width="1.5" stroke-linecap="round" opacity="0.4" />
            </g>

            <!-- Rising Steam Trails -->
            <path d="M 36 38 Q 32 26 38 18 Q 42 12 39 8" fill="none" stroke="#cbd5e1" stroke-width="1.8" stroke-linecap="round" opacity="0.25" />
            <path d="M 60 26 Q 56 16 62 10" fill="none" stroke="#cbd5e1" stroke-width="1.2" stroke-linecap="round" opacity="0.2" />
        </svg>`;
    }
    if (clean.includes('american') || clean.includes('burger') || clean.includes('usa')) {
        return `<svg viewBox="0 0 100 100" class="shadow-filter">
            <defs>
                <linearGradient id="bun-top-us" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#fb923c" />
                    <stop offset="60%" stop-color="#f97316" />
                    <stop offset="100%" stop-color="#b45309" />
                </linearGradient>
                <linearGradient id="bun-bottom-us" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#fb923c" />
                    <stop offset="100%" stop-color="#b45309" />
                </linearGradient>
                <linearGradient id="patty-meat-us" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#451a03" />
                    <stop offset="40%" stop-color="#272522" />
                    <stop offset="100%" stop-color="#141412" />
                </linearGradient>
                <linearGradient id="cheese-melt-us" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#fde047" />
                    <stop offset="100%" stop-color="#ea580c" />
                </linearGradient>
                <linearGradient id="tomato-slice-us" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#f87171" />
                    <stop offset="40%" stop-color="#dc2626" />
                    <stop offset="100%" stop-color="#991b1b" />
                </linearGradient>
            </defs>
            <!-- Soft ambient shadow directly under the bottom bun -->
            <ellipse cx="50" cy="74" rx="33" ry="5" fill="#1c1917" opacity="0.3" />
            <ellipse cx="50" cy="74" rx="22" ry="3" fill="#000000" opacity="0.2" />

            <!-- Bottom Bun -->
            <path d="M 22 68 C 22 68, 20 76, 50 76 C 80 76, 78 68, 78 68 Z" fill="url(#bun-bottom-us)" />
            <ellipse cx="50" cy="68" rx="28" ry="2.5" fill="#92400e" opacity="0.3" />

            <!-- Lettuce Leaf (Beautifully ruffled green) -->
            <path d="M 18 64 C 14 62, 22 58, 28 60 C 34 58, 42 59, 48 61 C 54 59, 62 58, 68 60 C 74 58, 86 62, 82 64 C 74 68, 26 68, 18 64 Z" fill="#22c55e" />
            <path d="M 22 63 C 24 61, 28 62, 30 60 C 35 59, 45 61, 48 61 C 52 61, 58 59, 62 60 C 66 61, 74 59, 78 63" fill="none" stroke="#15803d" stroke-width="1" />

            <!-- Thick Grilled Beef Patty -->
            <path d="M 19 55 C 19 55, 17 63, 50 63 C 83 63, 81 55, 81 55 C 81 55, 78 50, 50 50 C 22 50, 19 55, 19 55 Z" fill="url(#patty-meat-us)" />
            <!-- Patty grill marks/texture -->
            <path d="M 23 57 Q 50 60 77 57" fill="none" stroke="#000000" stroke-width="0.8" opacity="0.4" />

            <!-- Cheddar Cheese (Melting elegantly over the patty edges) -->
            <path d="M 20 54 Q 35 55 38 58 Q 42 61 46 54 Q 54 53 58 60 Q 62 62 68 53 Q 75 54 80 54 L 78 51 Q 50 49 22 51 Z" fill="url(#cheese-melt-us)" />
            <!-- Shiny cheese highlights -->
            <path d="M 22 52 Q 35 53 38 56 Q 42 58 45 52" fill="none" stroke="#ffffff" stroke-width="0.6" opacity="0.6" />

            <!-- TWO THICK TOMATO SLICES (Vibrant & highly visible peeking out on top of cheese) -->
            <!-- Left Tomato Slice -->
            <g transform="translate(23, 43) rotate(-6)">
                <rect x="0" y="0" width="23" height="6.5" rx="2" fill="url(#tomato-slice-us)" />
                <!-- Tomato pulp detailing -->
                <rect x="2" y="1" width="19" height="4.5" rx="1.2" fill="#ef4444" />
                <circle cx="6" cy="3.2" r="0.7" fill="#fbbf24" />
                <circle cx="17" cy="3.2" r="0.7" fill="#fbbf24" />
                <path d="M 4 2 A 4 4 0 0 1 9 2" fill="none" stroke="#ffffff" stroke-width="0.7" stroke-linecap="round" opacity="0.75" />
            </g>

            <!-- Right Tomato Slice -->
            <g transform="translate(53, 44) rotate(8)">
                <rect x="0" y="0" width="23" height="6.5" rx="2" fill="url(#tomato-slice-us)" />
                <rect x="2" y="1" width="19" height="4.5" rx="1.2" fill="#ef4444" />
                <circle cx="7" cy="3.2" r="0.7" fill="#fbbf24" />
                <circle cx="16" cy="3.2" r="0.7" fill="#fbbf24" />
                <path d="M 4 2 A 4 4 0 0 1 9 2" fill="none" stroke="#ffffff" stroke-width="0.7" stroke-linecap="round" opacity="0.75" />
            </g>

            <!-- Red Onion Ring -->
            <ellipse cx="38" cy="41" rx="13" ry="2.5" fill="none" stroke="#7e22ce" stroke-width="2" transform="rotate(-5, 38, 41)" opacity="0.8" />
            <ellipse cx="38" cy="41" rx="12" ry="2" fill="none" stroke="#f3e8ff" stroke-width="0.6" transform="rotate(-5, 38, 41)" opacity="0.9" />

            <!-- Top Bun (Glistening Dome) -->
            <path d="M 20 40 C 20 20, 80 20, 80 40 C 80 45, 72 46, 50 46 C 28 46, 20 45, 20 40 Z" fill="url(#bun-top-us)" />
            <!-- Highlights -->
            <ellipse cx="44" cy="28" rx="14" ry="4" fill="#ffffff" opacity="0.15" />
            <ellipse cx="40" cy="27" rx="8" ry="2" fill="#ffffff" opacity="0.2" />

            <!-- Sesame Seeds -->
            <g fill="#fef3c7" opacity="0.9">
                <ellipse cx="42" cy="25" rx="0.8" ry="1.6" transform="rotate(35, 42, 25)" />
                <ellipse cx="54" cy="24" rx="0.8" ry="1.6" transform="rotate(-25, 54, 24)" />
                <ellipse cx="34" cy="31" rx="0.8" ry="1.6" transform="rotate(-45, 34, 31)" />
                <ellipse cx="64" cy="30" rx="0.8" ry="1.6" transform="rotate(15, 64, 30)" />
                <ellipse cx="48" cy="30" rx="0.8" ry="1.6" transform="rotate(60, 48, 30)" />
                <ellipse cx="58" cy="33" rx="0.8" ry="1.6" transform="rotate(-15, 58, 33)" />
                <ellipse cx="38" cy="35" rx="0.8" ry="1.6" transform="rotate(25, 38, 35)" />
            </g>

            <!-- Wooden Pick/Skewer -->
            <line x1="50" y1="16" x2="50" y2="42" stroke="#d97706" stroke-width="1.8" />
            <circle cx="50" cy="16" r="2.5" fill="#78350f" />
        </svg>`;
    }
    if (clean.includes('mexican') || clean.includes('burrito') || clean.includes('taco') || clean.includes('mexico') || clean.includes('avocado')) {
        return `<svg viewBox="0 0 100 100" class="shadow-filter">
            <defs>
                <!-- Textured Skin Gradient -->
                <linearGradient id="avocado-skin-mx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#1b3b1e" />
                    <stop offset="50%" stop-color="#0f2614" />
                    <stop offset="100%" stop-color="#061208" />
                </linearGradient>
                
                <!-- Flesh Gradient centered around the Pit at (50, 62) -->
                <radialGradient id="avocado-flesh-mx" cx="50%" cy="62%" r="60%">
                    <stop offset="0%" stop-color="#fffbeb" />
                    <stop offset="25%" stop-color="#fef9c3" />
                    <stop offset="50%" stop-color="#ecfccb" />
                    <stop offset="75%" stop-color="#a3e635" />
                    <stop offset="92%" stop-color="#4d7c0f" />
                    <stop offset="100%" stop-color="#143b0c" />
                </radialGradient>
                
                <!-- 3D Pit Spherical Gradient with offset light source -->
                <radialGradient id="avocado-pit-mx" cx="35%" cy="30%" r="65%">
                    <stop offset="0%" stop-color="#d97706" />
                    <stop offset="45%" stop-color="#92400e" />
                    <stop offset="80%" stop-color="#78350f" />
                    <stop offset="100%" stop-color="#451a03" />
                </radialGradient>
            </defs>

            <!-- Ground/Drop Shadows for depth -->
            <ellipse cx="50" cy="85" rx="26" ry="6" fill="#061208" opacity="0.22" />
            <ellipse cx="50" cy="85" rx="16" ry="3.5" fill="#000000" opacity="0.18" />

            <!-- 1. Outer Skin - Pear-shaped contoured leather boundary -->
            <path d="M 50 15 C 37 15, 25 34, 23 54 C 21 72.5, 34 85, 50 85 C 66 85, 79 72.5, 77 54 C 75 34, 63 15, 50 15 Z" fill="url(#avocado-skin-mx)" stroke="#09180a" stroke-width="0.8" />

            <!-- 2. Glistening Flesh Inset -->
            <path d="M 50 17.5 C 38.5 17.5, 27 35.5, 25 54 C 23 71, 35.5 82.5, 50 82.5 C 64.5 82.5, 77 71, 75 54 C 73 35.5, 61.5 17.5, 50 17.5 Z" fill="url(#avocado-flesh-mx)" />

            <!-- Stem Cap (Woody attachment at top) -->
            <path d="M 47 15.5 C 47 13.8, 53 13.8, 53 15.5 C 52 16.5, 48 16.5, 47 15.5 Z" fill="#451a03" />
            <ellipse cx="50" cy="14.5" rx="1.5" ry="0.6" fill="#78350f" />

            <!-- Flesh specular highlights (glossy surface moisture) -->
            <!-- Left shoulder highlight -->
            <path d="M 33 40 C 30.5 48, 30.5 56, 33.5 63" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" opacity="0.32" />
            <!-- Right lower highlight -->
            <path d="M 68 62 C 67 69, 62 74, 55 77" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round" opacity="0.22" />

            <!-- Pit Cavity Shadow & Blend Ring -->
            <circle cx="50" cy="62" r="13" fill="#2d1502" opacity="0.14" />
            <circle cx="50" cy="62" r="12" fill="#1e0c01" opacity="0.2" />

            <!-- 3. Spherical 3D Seed/Pit -->
            <circle cx="50" cy="62" r="11.5" fill="url(#avocado-pit-mx)" />

            <!-- Pit Glistening reflections -->
            <!-- Large Soft Specular Highlight -->
            <ellipse cx="46.5" cy="58.5" rx="3.5" ry="1.8" fill="#ffffff" opacity="0.55" transform="rotate(-30, 46.5, 58.5)" />
            <!-- Bright Sharp Highlight -->
            <circle cx="44.5" cy="56.5" r="0.75" fill="#ffffff" opacity="0.85" />
            <!-- Bottom-right bounce light reflection -->
            <path d="M 55 68 C 57.2 66, 58.5 63, 58.5 60" fill="none" stroke="#ffffff" stroke-width="0.7" stroke-linecap="round" opacity="0.28" />
        </svg>`;
    }
    if (clean.includes('indian') || clean.includes('samosa') || clean.includes('curry') || clean.includes('india')) {
        return `<svg viewBox="0 0 100 100" class="shadow-filter">
            <defs>
                <linearGradient id="samosa-dough-back" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#fcd34d" />
                    <stop offset="60%" stop-color="#d97706" />
                    <stop offset="100%" stop-color="#9a3412" />
                </linearGradient>
                <linearGradient id="samosa-dough-front-1" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#fde047" />
                    <stop offset="60%" stop-color="#ea580c" />
                    <stop offset="100%" stop-color="#b45309" />
                </linearGradient>
                <linearGradient id="samosa-dough-front-2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#fbbf24" />
                    <stop offset="60%" stop-color="#b45309" />
                    <stop offset="100%" stop-color="#78350f" />
                </linearGradient>
                <linearGradient id="chutney-tamarind" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#ef4444" />
                    <stop offset="60%" stop-color="#b91c1c" />
                    <stop offset="100%" stop-color="#7f1d1d" />
                </linearGradient>
                <radialGradient id="samosa-bubble" cx="40%" cy="40%" r="60%">
                    <stop offset="0%" stop-color="#fef08a" />
                    <stop offset="50%" stop-color="#ca8a04" />
                    <stop offset="100%" stop-color="#78350f" />
                </radialGradient>
            </defs>
            <!-- Soft Ambient Ground Shadows under samosas -->
            <ellipse cx="38" cy="74" rx="20" ry="4.5" fill="#78350f" opacity="0.22" />
            <ellipse cx="64" cy="75" rx="18" ry="4" fill="#78350f" opacity="0.22" />

            <!-- SAMOSA 1: BACK (Whole, standing tall) -->
            <g transform="translate(18, 25) rotate(-8)">
                <!-- Back triangular pastry shadow face -->
                <path d="M 24 10 L 4 48 L 44 48 Z" fill="url(#samosa-dough-back)" />
                <!-- Light face -->
                <path d="M 24 10 L 22 48 L 4 48 Z" fill="#fde047" opacity="0.15" />
                <!-- Seam Fold -->
                <path d="M 24 10 Q 25 30 22 48" fill="none" stroke="#78350f" stroke-width="1.2" opacity="0.4" />
                <!-- Bubbled/Crisp spots -->
                <ellipse cx="14" cy="38" rx="2.5" ry="1.8" fill="url(#samosa-bubble)" />
                <ellipse cx="32" cy="42" rx="1.8" ry="1.2" fill="url(#samosa-bubble)" />
                <circle cx="20" cy="28" r="0.6" fill="#78350f" />
            </g>

            <!-- SAMOSA 2: FRONT (Large, highly detailed, drizzled in rich tamarind chutney) -->
            <g transform="translate(38, 30) rotate(5)">
                <!-- Right Facet (Shaded) -->
                <path d="M 25 8 L 45 42 L 5 42 Z" fill="none" />
                <path d="M 25 8 L 45 42 L 23 42 Z" fill="url(#samosa-dough-front-2)" />
                <!-- Left Facet (Lighted) -->
                <path d="M 25 8 L 23 42 L 5 42 Z" fill="url(#samosa-dough-front-1)" />
                
                <!-- Fold Seam along the center ridge -->
                <path d="M 25 8 Q 24 25 23 42" fill="none" stroke="#78350f" stroke-width="1.5" opacity="0.6" />
                <!-- Crimped folded bottom edge -->
                <path d="M 5 42 Q 25 45 45 42 L 44 40 Q 25 43 6 40 Z" fill="#78350f" opacity="0.3" />

                <!-- Crispy bubbled textures -->
                <ellipse cx="14" cy="24" rx="2.5" ry="1.5" fill="url(#samosa-bubble)" />
                <ellipse cx="34" cy="32" rx="3" ry="1.8" fill="url(#samosa-bubble)" />
                <circle cx="28" cy="21" r="0.7" fill="#78350f" />
                <circle cx="16" cy="34" r="0.7" fill="#78350f" />
                <circle cx="36" cy="25" r="0.5" fill="#78350f" />

                <!-- Glossy Tamarind Chutney Drizzle dripping down the center seam -->
                <path d="M 25 12 Q 23 20 26 23 Q 29 26 24 30 Q 21 34 23 37 Q 24 39 23 41 L 22 41 Q 22 38 21 36 Q 20 33 22 29 Q 27 25 24 22 Q 21 18 23 12 Z" fill="url(#chutney-tamarind)" />
                <circle cx="23.2" cy="41.5" r="0.8" fill="url(#chutney-tamarind)" /> <!-- Dripping drop -->
                
                <!-- Glistening shine overlay on the chutney -->
                <path d="M 24.5 13 Q 23.5 18 25.5 21" fill="none" stroke="#ffffff" stroke-width="0.8" stroke-linecap="round" opacity="0.7" />
                <path d="M 27 24 Q 28 25 26 27" fill="none" stroke="#ffffff" stroke-width="0.6" stroke-linecap="round" opacity="0.7" />
            </g>

            <!-- Parsley/Coriander leaf sprig garnish next to them -->
            <g fill="#22c55e" opacity="0.95" transform="translate(34, 70) rotate(-15)">
                <path d="M 6 4 C 4 2, 8 0, 7 3 C 9 2, 10 4, 8 5 Z" />
                <circle cx="7" cy="3.5" r="0.5" fill="#15803d" />
            </g>
            <g fill="#22c55e" opacity="0.9" transform="translate(68, 72) rotate(25)">
                <path d="M 6 4 C 4 2, 8 0, 7 3 C 9 2, 10 4, 8 5 Z" />
            </g>
        </svg>`;
    }
    if (clean.includes('healthy') || clean.includes('veg') || clean.includes('vegan') || clean.includes('diet')) return '🥦';
    if (clean.includes('breakfast') || clean.includes('egg') || clean.includes('morning')) return '🍳';
    if (clean.includes('quick') || clean.includes('fast') || clean.includes('minute') || clean.includes('easy')) return '⏱️';
    if (clean.includes('dinner') || clean.includes('classic') || clean.includes('main')) return '🍽️';
    if (clean.includes('oven') || clean.includes('roast') || clean.includes('chicken')) {
        return `<svg viewBox="0 0 100 100" class="shadow-filter">
            <defs>
                <linearGradient id="board-wood-1-oven" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#b45309" />
                    <stop offset="50%" stop-color="#78350f" />
                    <stop offset="100%" stop-color="#451a03" />
                </linearGradient>
                <linearGradient id="board-wood-2-oven" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#d97706" />
                    <stop offset="100%" stop-color="#92400e" />
                </linearGradient>
                <radialGradient id="chicken-body-g-oven" cx="50%" cy="40%" r="60%" fx="40%" fy="30%">
                    <stop offset="0%" stop-color="#f59e0b" />
                    <stop offset="40%" stop-color="#d97706" />
                    <stop offset="75%" stop-color="#b45309" />
                    <stop offset="100%" stop-color="#78350f" />
                </radialGradient>
                <radialGradient id="chicken-drum-g-oven" cx="50%" cy="30%" r="50%">
                    <stop offset="0%" stop-color="#fbbf24" />
                    <stop offset="50%" stop-color="#ca8a04" />
                    <stop offset="100%" stop-color="#78350f" />
                </radialGradient>
                <linearGradient id="bone-shading-oven" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#ffffff" />
                    <stop offset="80%" stop-color="#cbd5e1" />
                    <stop offset="100%" stop-color="#94a3b8" />
                </linearGradient>
            </defs>
            <ellipse cx="50" cy="74" rx="46" ry="14" fill="url(#board-wood-1-oven)" />
            <ellipse cx="50" cy="71" rx="43" ry="12" fill="url(#board-wood-2-oven)" />
            <path d="M 12 70 Q 50 61 88 70" fill="none" stroke="#78350f" stroke-width="1" opacity="0.3" />
            <path d="M 16 73 Q 50 64 84 73" fill="none" stroke="#78350f" stroke-width="1.2" opacity="0.3" />
            <ellipse cx="50" cy="71" rx="39" ry="10" fill="none" stroke="#451a03" stroke-width="1" opacity="0.4" />
            <ellipse cx="50" cy="62" rx="28" ry="11" fill="#451a03" opacity="0.65" />
            <g transform="translate(0, 2)">
                <ellipse cx="50" cy="50" rx="24" ry="17" fill="url(#chicken-body-g-oven)" />
                <path d="M 32 46 C 30 38, 50 30, 50 50 Z" fill="#f59e0b" opacity="0.15" />
                <path d="M 28 44 C 20 44, 20 54, 30 56 C 26 50, 26 46, 28 44 Z" fill="url(#chicken-drum-g-oven)" stroke="#78350f" stroke-width="0.5" />
                <path d="M 26 47 C 22 47, 22 52, 28 53" fill="none" stroke="#b45309" stroke-width="1" />
                <path d="M 72 44 C 80 44, 80 54, 70 56 C 74 50, 74 46, 72 44 Z" fill="url(#chicken-drum-g-oven)" stroke="#78350f" stroke-width="0.5" />
                <path d="M 74 47 C 78 47, 78 52, 72 53" fill="none" stroke="#b45309" stroke-width="1" />
                <g transform="translate(36, 52) rotate(-20)">
                    <ellipse cx="0" cy="0" rx="10" ry="14" fill="url(#chicken-drum-g-oven)" />
                    <path d="M -2 12 L -6 24" stroke="url(#bone-shading-oven)" stroke-width="4.5" stroke-linecap="round" />
                    <circle cx="-8" cy="24" r="3" fill="url(#bone-shading-oven)" />
                    <circle cx="-4" cy="25" r="3" fill="url(#bone-shading-oven)" />
                </g>
                <g transform="translate(64, 52) rotate(20)">
                    <ellipse cx="0" cy="0" rx="10" ry="14" fill="url(#chicken-drum-g-oven)" />
                    <path d="M 2 12 L 6 24" stroke="url(#bone-shading-oven)" stroke-width="4.5" stroke-linecap="round" />
                    <circle cx="8" cy="24" r="3" fill="url(#bone-shading-oven)" />
                    <circle cx="4" cy="25" r="3" fill="url(#bone-shading-oven)" />
                </g>
                <path d="M 50 36 C 46 36, 44 48, 50 56 C 56 48, 54 36, 50 36 Z" fill="#fef08a" opacity="0.25" />
                <circle cx="45" cy="42" r="1" fill="#ffffff" opacity="0.8" />
                <circle cx="56" cy="44" r="0.8" fill="#ffffff" opacity="0.8" />
                <circle cx="51" cy="48" r="1.2" fill="#ffffff" opacity="0.8" />
                <circle cx="38" cy="52" r="0.7" fill="#ffffff" opacity="0.8" />
                <circle cx="62" cy="52" r="0.7" fill="#ffffff" opacity="0.8" />
                <path d="M 44 32 Q 50 28 56 34 Q 50 38 44 32" fill="none" stroke="#16a34a" stroke-width="1.5" />
                <circle cx="48" cy="30" r="1" fill="#15803d" />
                <circle cx="52" cy="31" r="1" fill="#15803d" />
                <circle cx="46" cy="34" r="1" fill="#15803d" />
                <circle cx="54" cy="35" r="1" fill="#15803d" />
            </g>
        </svg>`;
    }
    return '🍳'; // Elegant default pan emoji
}

// --- DISPLAY FUNCTIONS ---
function displayTags(updateUrl = true) {
    if (updateUrl) {
        history.pushState({ view: 'tags' }, '', '/');
    }

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
        return a.localeCompare(b); // Alphabetical fallback if counts are equal
    });

    const container = document.getElementById('tag-list-container');
    container.innerHTML = '';

    if (sortedTags.length === 0) {
        container.innerHTML = `<p class="empty-state">No recipes found. Add one to get started!</p>`;
    } else {
        sortedTags.forEach(tag => {
            const card = document.createElement('div');
            card.className = 'tag-card theme-card';
            
            const icon = getCategoryIcon(tag);
            
            card.innerHTML = `
                <span class="theme-icon">${icon}</span>
                <span class="theme-title">${tag}</span>
            `;
            card.addEventListener('click', () => displayRecipesByTag(tag));
            container.appendChild(card);
        });
    }
    showView('tag-list-container');
}

function displayRecipesByTag(tag, updateUrl = true) {
    if (updateUrl) {
        const url = `/tag/${encodeURIComponent(tag)}`;
        history.pushState({ view: 'recipeList', tag: tag }, '', url);
    }

    // Filter recipes based on tag and conditional ownership toggle
    let recipes = appState.allRecipes.filter(recipe => recipe.tags && recipe.tags.includes(tag));
    if (appState.isGoogleUser && appState.showOnlyOwnRecipes) {
        recipes = recipes.filter(recipe => recipe.userId === appState.currentUserId);
    }

    const listDiv = document.getElementById('recipe-list');
    listDiv.innerHTML = '';

    if (recipes.length === 0) {
        listDiv.innerHTML = `<p class="empty-state">No recipes found.</p>`;
    } else {
        recipes.forEach(recipe => {
            const item = document.createElement('div');
            item.className = 'recipe-item';
            item.innerHTML = `<h3>${recipe.title}</h3>`;
            item.addEventListener('click', () => displayRecipeDetails(recipe.id));
            listDiv.appendChild(item);
        });
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

    const header = document.createElement('div');
    header.className = 'recipe-detail-header';
    const titleTagsWrapper = document.createElement('div');
    titleTagsWrapper.className = 'recipe-title-tags-wrapper';
    const title = document.createElement('h2');
    title.id = 'recipe-title-detail';
    title.textContent = recipe.title;
    const tags = document.createElement('div');
    tags.id = 'recipe-tags-detail';
    (recipe.tags || []).forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = 'tag-item';
        tagEl.textContent = tag;
        tags.appendChild(tagEl);
    });
    titleTagsWrapper.appendChild(title);
    titleTagsWrapper.appendChild(tags);
    header.appendChild(titleTagsWrapper);

    const ingredientsTitle = document.createElement('h3');
    ingredientsTitle.textContent = 'Ingredients';
    const ingredientsList = document.createElement('ul');
    ingredientsList.id = 'recipe-ingredients-detail';
    (recipe.ingredients || '').split('\n').forEach((ing, idx) => {
        if (ing.trim()) {
            const li = document.createElement('li');
            const label = document.createElement('label');
            label.className = 'ingredient-checkbox-wrapper';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `ing-${idx}`;
            
            const customSpan = document.createElement('span');
            customSpan.className = 'ingredient-checkbox-custom';
            
            const textSpan = document.createElement('span');
            textSpan.className = 'ingredient-text';
            textSpan.textContent = ing.trim();
            
            label.appendChild(checkbox);
            label.appendChild(customSpan);
            label.appendChild(textSpan);
            li.appendChild(label);
            ingredientsList.appendChild(li);
        }
    });

    const instructionsTitle = document.createElement('h3');
    instructionsTitle.textContent = 'Instructions';
    const instructions = document.createElement('p');
    instructions.id = 'recipe-instructions-detail';
    instructions.textContent = recipe.instructions || '';

    detailContainer.appendChild(header);
    detailContainer.appendChild(ingredientsTitle);
    detailContainer.appendChild(ingredientsList);
    detailContainer.appendChild(instructionsTitle);
    detailContainer.appendChild(instructions);

    // Only Google Auth users who are the creator OR admin can see Edit/Delete buttons
    const isOwner = recipe.userId === appState.currentUserId;
    const isAdmin = appState.currentUserEmail === 'uzeyirsalman@gmail.com';

    if (appState.isGoogleUser && (isOwner || isAdmin)) {
        const actionsContainer = document.createElement('div');
        actionsContainer.id = 'recipe-actions';
        const editButton = document.createElement('button');
        editButton.textContent = 'Edit';
        editButton.className = 'action-button edit-btn';
        editButton.onclick = () => showEditRecipeForm(recipe.id);
        const deleteButton = document.createElement('button');
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
    }, 700);
}

function handleRandomClick(event) {
    event.preventDefault();
    if (appState.allRecipes.length === 0) {
        showNotification("No recipes available to choose from.");
        return;
    }
    const randomIndex = Math.floor(Math.random() * appState.allRecipes.length);
    const randomRecipe = appState.allRecipes[randomIndex];
    displayRecipeDetails(randomRecipe.id);
}

// --- SEARCH FUNCTIONS ---
function toggleSearchInput() {
    const searchInput = document.getElementById('search-input');
    const header = document.querySelector('header');
    header.classList.toggle('search-active');
    if (header.classList.contains('search-active')) {
        searchInput.focus();
    }
}

function handleSearch(event) {
    if (event.key === 'Enter') {
        const searchTerm = event.target.value.trim();
        if (searchTerm) {
            let matchedRecipes = appState.allRecipes.filter(recipe =>
                recipe.title.toLowerCase().includes(searchTerm.toLowerCase())
            );
            if (appState.isGoogleUser && appState.showOnlyOwnRecipes) {
                matchedRecipes = matchedRecipes.filter(recipe => recipe.userId === appState.currentUserId);
            }
            displaySearchResults(matchedRecipes, searchTerm);
        } else {
            displayTags();
        }
        toggleSearchInput();
    }
}

function displaySearchResults(recipes, searchTerm) {
    const container = document.getElementById('search-results-container');
    container.innerHTML = '';

    const header = document.createElement('h2');
    header.textContent = `Search Results for "${searchTerm}"`;
    header.style.textAlign = 'center';
    header.style.marginBottom = '1rem';
    container.appendChild(header);

    if (recipes.length === 0) {
        container.innerHTML += `<p class="empty-state">No recipes found with that title.</p>`;
    } else {
        const listDiv = document.createElement('div');
        listDiv.id = 'search-results-list';
        recipes.forEach(recipe => {
            const item = document.createElement('div');
            item.className = 'recipe-item';
            item.innerHTML = `<h3>${recipe.title}</h3>`;
            item.addEventListener('click', () => displayRecipeDetails(recipe.id));
            listDiv.appendChild(item);
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
    document.getElementById('form-mode-title').textContent = 'Add a New Recipe';
    document.getElementById('recipe-form').reset();
    document.getElementById('save-button').textContent = 'Save Recipe';
    showView('recipe-form-container');

    const form = document.getElementById('recipe-form');
    form.classList.add('fade-in-view');
    setTimeout(() => form.classList.remove('fade-in-view'), 700);
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
    
    document.getElementById('form-mode-title').textContent = 'Edit Recipe';
    document.getElementById('recipe-title').value = recipe.title;
    document.getElementById('recipe-tags').value = (recipe.tags || []).join(', ');
    document.getElementById('recipe-ingredients').value = recipe.ingredients;
    document.getElementById('recipe-instructions').value = recipe.instructions;
    document.getElementById('save-button').textContent = 'Update Recipe';
    showView('recipe-form-container');

    const form = document.getElementById('recipe-form');
    form.classList.add('fade-in-view');
    setTimeout(() => form.classList.remove('fade-in-view'), 700);
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
            // Update: only update content fields; preserve original userId, author, and createdAt
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
            await logActivity("update", recipeId, formattedTitle); // Log update
        } else {
            // Create: include all ownership and timestamp metadata
            const recipeData = {
                title: formattedTitle,
                tags: document.getElementById('recipe-tags').value
                    .split(',')
                    .map(tag => toTitleCase(tag.trim()))
                    .filter(tag => tag),
                ingredients: document.getElementById('recipe-ingredients').value,
                instructions: document.getElementById('recipe-instructions').value,
                userId: appState.currentUserId,
                author: appState.currentUserEmail, // Save author email
                createdAt: serverTimestamp()
            };
            const docRef = await addDoc(recipesCollection, recipeData);
            savedRecipeId = docRef.id;
            await logActivity("create", savedRecipeId, formattedTitle); // Log creation
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
    }
    
    confirmBtn.addEventListener('click', confirmHandler);
    cancelBtn.addEventListener('click', cancelHandler);
}

async function deleteRecipe(id) {
    // Check role first
    if (!appState.isGoogleUser) {
        showNotification("Permission denied: Google sign in required.");
        return;
    }

    const recipe = appState.allRecipes.find(r => r.id === id);
    const title = recipe ? recipe.title : "Recipe";

    try {
        await deleteDoc(doc(getSharedRecipesCollection(), id));
        await logActivity("delete", id, title); // Log delete
        showNotification('Recipe deleted.');
        displayTags(true); 
    } catch (error) {
        console.error("Error deleting recipe: ", error);
        showNotification("Error: Could not delete the recipe.");
    }
}
