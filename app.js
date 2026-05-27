import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
    allRecipes: [],
    unsubscribeFromRecipes: null,
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
        if (user) {
            appState.currentUserId = user.uid;
            
            // --- EVENT LISTENERS ---
            document.getElementById('home-btn').addEventListener('click', () => displayTags());
            document.getElementById('random-recipe-btn').addEventListener('click', handleRandomClick);
            document.getElementById('add-recipe-btn').addEventListener('click', () => showAddRecipeForm());
            document.getElementById('recipe-form').addEventListener('submit', handleFormSubmit);
            document.getElementById('search-btn').addEventListener('click', toggleSearchInput);
            document.getElementById('search-input').addEventListener('keydown', handleSearch);

            // Settings/Backup listeners
            document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
            document.getElementById('settings-close-btn').addEventListener('click', closeSettingsModal);
            document.getElementById('export-backup-btn').addEventListener('click', handleExportBackup);
            document.getElementById('import-file-input').addEventListener('change', handleImportBackup);

            listenForRecipes(router);
        } else {
            try {
                const initialAuthToken = null; 
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) {
                console.error("Authentication failed:", error);
                showNotification("Authentication failed.");
            }
        }
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

    // Map only clean properties to match existing backup JSON format
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
            
            // Validate: must be an array
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
                
                // Format tags properly
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
                    userId: appState.currentUserId || "system",
                    createdAt: serverTimestamp()
                };

                // Check if already exists by title
                const existingRecipe = appState.allRecipes.find(r => r.title.toLowerCase() === formattedTitle.toLowerCase());

                try {
                    if (existingRecipe) {
                        // Overwrite/update existing recipe in Firestore
                        const recipeRef = doc(recipesCollection, existingRecipe.id);
                        await updateDoc(recipeRef, recipeData);
                        duplicateCount++;
                    } else {
                        // Add as new recipe
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
        { title: 'Shared Tomato Soup', tags: ['Soup', 'Vegetarian', 'Classic'], ingredients: '1 kg ripe tomatoes\n2 tbsp olive oil\n1 onion, chopped', instructions: '1. Sauté onion.\n2. Add tomatoes and broth, simmer.\n3. Blend until smooth.', userId: 'system', createdAt: serverTimestamp() },
        { title: 'Shared Garden Salad', tags: ['Salad', 'Quick', 'Healthy'], ingredients: '1 head of lettuce\n1 cucumber, sliced\n2 tomatoes, chopped', instructions: 'Combine all vegetables in a large bowl and toss with vinaigrette.', userId: 'system', createdAt: serverTimestamp() }
    ];
    for (const recipe of defaultRecipes) {
        // Use title as document ID to prevent duplicates on reload
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

    const tagCounts = {};
    appState.allRecipes.forEach(recipe => {
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

    const recipes = appState.allRecipes.filter(recipe => recipe.tags && recipe.tags.includes(tag));
    const container = document.getElementById('recipe-list-container');
    
    container.innerHTML = '';
    
    const header = document.createElement('div');
    header.className = 'recipe-list-header';
    
    const listDiv = document.createElement('div');
    listDiv.id = 'recipe-list';
    
    recipes.forEach(recipe => {
        const item = document.createElement('div');
        item.className = 'recipe-item';
        item.innerHTML = `<h3>${recipe.title}</h3>`;
        item.addEventListener('click', () => displayRecipeDetails(recipe.id));
        listDiv.appendChild(item);
    });

    container.appendChild(listDiv);
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

    if (appState.currentUserId === recipe.userId || recipe.userId === 'system' || !recipe.userId) {
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
            const matchedRecipes = appState.allRecipes.filter(recipe =>
                recipe.title.toLowerCase().includes(searchTerm.toLowerCase())
            );
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
    if (!appState.currentUserId) {
        showNotification("You must be signed in to save recipes.");
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
        createdAt: serverTimestamp()
    };

    try {
        const recipesCollection = getSharedRecipesCollection();
        let savedRecipeId = recipeId;
        if (recipeId) {
            const recipeRef = doc(recipesCollection, recipeId);
            await updateDoc(recipeRef, recipeData);
        } else {
            const docRef = await addDoc(recipesCollection, recipeData);
            savedRecipeId = docRef.id;
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
    try {
        await deleteDoc(doc(getSharedRecipesCollection(), id));
        showNotification('Recipe deleted.');
        displayTags(true); 
    } catch (error) {
        console.error("Error deleting recipe: ", error);
        showNotification("Error: Could not delete the recipe.");
    }
}
