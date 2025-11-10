(function() {
    'use strict';
    
    console.log('[e621 Auto-DL] Extension loaded!');
    
    const recentDownloads = new Set();
    
    function getPostId() {
        const match = window.location.pathname.match(/\/posts\/(\d+)/);
        const postId = match ? match[1] : null;
        console.log('[e621 Auto-DL] Current post ID:', postId);
        return postId;
    }
    
    async function downloadPost(postId) {
        if (recentDownloads.has(postId)) {
            console.log('[e621 Auto-DL] Download already triggered recently for post', postId, '- skipping duplicate');
            return;
        }
        
        recentDownloads.add(postId);
        
        setTimeout(() => {
            recentDownloads.delete(postId);
            console.log('[e621 Auto-DL] Download cooldown expired for post', postId);
        }, 5000);
        
        try {
            console.log(`[e621 Auto-DL] ===== DOWNLOAD TRIGGERED for post ${postId} =====`);
            
            const apiUrl = `https://e621.net/posts/${postId}.json`;
            console.log('[e621 Auto-DL] Fetching from:', apiUrl);
            
            const response = await fetch(apiUrl);
            console.log('[e621 Auto-DL] API Response status:', response.status);
            
            if (!response.ok) {
                console.error('[e621 Auto-DL] Failed to fetch post data, status:', response.status);
                return;
            }
            
            const data = await response.json();
            console.log('[e621 Auto-DL] Post data received:', data);
            
            const post = data.post;
            
            if (!post || !post.file || !post.file.url) {
                console.error('[e621 Auto-DL] No file URL found in post data');
                console.error('[e621 Auto-DL] Post object:', post);
                return;
            }
            
            const downloadData = {
                action: 'download',
                url: post.file.url,
                filename: `e621_${postId}_${post.file.md5}.${post.file.ext}`,
                postId: postId
            };
            
            console.log('[e621 Auto-DL] Sending download message:', downloadData);
            
            chrome.runtime.sendMessage(downloadData, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[e621 Auto-DL] Message error:', chrome.runtime.lastError);
                } else {
                    console.log('[e621 Auto-DL] Message sent successfully, response:', response);
                }
            });
            
        } catch (error) {
            console.error('[e621 Auto-DL] Error in downloadPost:', error);
        }
    }
    
    function checkIfFavorited(button) {
        if (!button) {
            return false;
        }
        
        const favAttr = button.getAttribute('favorited');
        const isFav = favAttr === 'true';
        
        console.log('[e621 Auto-DL] Favorited attribute:', favAttr);
        console.log('[e621 Auto-DL] Is favorited:', isFav);
        
        return isFav;
    }
    
    function setupFavoriteDetection() {
        const postId = getPostId();
        if (!postId) {
            console.log('[e621 Auto-DL] No post ID found, exiting');
            return;
        }
        
        console.log('[e621 Auto-DL] Setting up favorite detection for post:', postId);
        
        let previouslyFavorited = false;
        
        const findFavButton = () => {
            return document.querySelector('button.ptbr-favorite-button, button[class*="favorite-button"]');
        };
        
        const favButton = findFavButton();
        if (favButton) {
            previouslyFavorited = checkIfFavorited(favButton);
            console.log('[e621 Auto-DL] Initial favorite state:', previouslyFavorited);
        }
        
        const favButtonElement = findFavButton();
        if (favButtonElement) {
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'favorited') {
                        const newValue = favButtonElement.getAttribute('favorited');
                        console.log('[e621 Auto-DL] Favorited attribute changed to:', newValue);
                        
                        if (newValue === 'true' && !previouslyFavorited) {
                            console.log('[e621 Auto-DL] ✓ Attribute changed to favorited! Starting download...');
                            downloadPost(postId);
                            previouslyFavorited = true;
                        } else if (newValue === 'false' || newValue === null) {
                            console.log('[e621 Auto-DL] Post unfavorited');
                            previouslyFavorited = false;
                        }
                    }
                }
            });
            
            observer.observe(favButtonElement, {
                attributes: true,
                attributeFilter: ['favorited']
            });
            
            console.log('[e621 Auto-DL] MutationObserver installed on favorite button');
        } else {
            console.warn('[e621 Auto-DL] Could not find favorite button to observe');
        }
        
        console.log('[e621 Auto-DL] Detection method installed');
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupFavoriteDetection);
    } else {
        setupFavoriteDetection();
    }
    
    document.addEventListener('turbolinks:load', () => {
        console.log('[e621 Auto-DL] Turbolinks page loaded');
        setupFavoriteDetection();
    });
    
})();
