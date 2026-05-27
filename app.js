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

            // UI updates
            document.getElementById('login-btn').classList.add('hidden');
            document.getElementById('user-profile').classList.remove('hidden');
            
            const avatar = document.getElementById('user-avatar');
            if (avatar) {
                avatar.src = user.photoURL || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z' fill='%236c757d'/%3E%3C/svg%3E";
            }
            
            // Show author features
            document.getElementById('add-recipe-btn').classList.remove('hidden');

            // Show global filter bar for logged-in users
            const filterBar = document.getElementById('filter-bar');
            if (filterBar) {
                filterBar.classList.remove('hidden');
                const filterCheckbox = document.getElementById('own-recipes-filter');
                if (filterCheckbox) {
                    filterCheckbox.checked = appState.showOnlyOwnRecipes;
                }
            }

            // Settings gear & Log Listener EXCLUSIVE to Admin
            if (appState.currentUserEmail === 'uzeyirsalman@gmail.com') {
                document.getElementById('settings-btn').classList.remove('hidden');
                listenForActivityLogs();
            } else {
                document.getElementById('settings-btn').classList.add('hidden');
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

            // UI updates
            document.getElementById('login-btn').classList.remove('hidden');
            document.getElementById('user-profile').classList.add('hidden');
            
            // Hide global filter bar
            const filterBar = document.getElementById('filter-bar');
            if (filterBar) {
                filterBar.classList.add('hidden');
            }

            // Hide author features & settings gear
            document.getElementById('add-recipe-btn').classList.add('hidden');
            document.getElementById('settings-btn').classList.add('hidden');

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
    document.getElementById('random-recipe-btn').addEventListener('click', handleRandomClick);
    document.getElementById('add-recipe-btn').addEventListener('click', () => {
        if (appState.isGoogleUser) {
            showAddRecipeForm();
        } else {
            showNotification("Please sign in with Google to add recipes.");
        }
    });
    document.getElementById('recipe-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('search-btn').addEventListener('click', toggleSearchInput);
    document.getElementById('search-input').addEventListener('keydown', handleSearch);

    // Settings/Backup listeners
    document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
    document.getElementById('settings-close-btn').addEventListener('click', closeSettingsModal);
    document.getElementById('export-backup-btn').addEventListener('click', handleExportBackup);
    document.getElementById('import-file-input').addEventListener('change', handleImportBackup);

    // Google Auth actions
    console.log("Registering Google login-btn click listener...");
    document.getElementById('login-btn').addEventListener('click', handleGoogleSignIn);
    document.getElementById('logout-btn').addEventListener('click', handleSignOut);

    // "My Recipes Only" filter checkbox listener
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

    const sortedTags = Object.keys(tagCounts).sort((a, b) => a.localeCompare(b));
    const container = document.getElementById('tag-list-container');
    container.innerHTML = '';

    if (sortedTags.length === 0) {
        container.innerHTML = `<p class="empty-state">No recipes found. Add one to get started!</p>`;
    } else {
        sortedTags.forEach(tag => {
            const card = document.createElement('div');
            card.className = 'tag-card';
            card.innerHTML = `
                <span>${tag}</span>
                <span class="recipe-count">${tagCounts[tag]}</span>
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
    (recipe.ingredients || '').split('\n').forEach(ing => {
        if (ing.trim()) {
            const li = document.createElement('li');
            li.textContent = ing;
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

    try {
        const recipesCollection = getSharedRecipesCollection();
        let savedRecipeId = recipeId;
        if (recipeId) {
            const recipeRef = doc(recipesCollection, recipeId);
            await updateDoc(recipeRef, recipeData);
            await logActivity("update", recipeId, formattedTitle); // Log update
        } else {
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
