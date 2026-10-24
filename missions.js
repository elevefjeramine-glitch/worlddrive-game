/**
 * Module de Missions et Progression pour jeu de voiture OpenStreetMap/Leaflet
 * Compatible avec Leaflet, sans API payante
 * Sauvegarde automatique dans localStorage
 */

// ============================================
// CONFIGURATION RÉGLABLE
// ============================================
const CONFIG = {
    // Paramètres généraux
    GAME_NAME: "OpenWorldRacing",
    SAVE_KEY: "openworld_racing_save",
    
    // Progression
    XP_PER_LEVEL: 100,
    LEVEL_UP_MULTIPLIER: 1.5,
    STARTING_MONEY: 500,
    STARTING_XP: 0,
    
    // Missions - Course contre la montre
    TIME_TRIAL: {
        BASE_TIME: 60, // secondes
        TIME_BONUS_PER_CHECKPOINT: 10,
        REWARD_POINTS: 100,
        REWARD_MONEY: 50,
        CHECKPOINT_RADIUS: 30, // mètres
        MIN_CHECKPOINTS: 3,
        MAX_CHECKPOINTS: 8
    },
    
    // Missions - Livraison
    DELIVERY: {
        TIME_LIMIT: 120, // secondes
        REWARD_POINTS: 150,
        REWARD_MONEY: 80,
        DESTINATION_RADIUS: 50, // mètres
        MIN_DISTANCE: 1000, // mètres
        MAX_DISTANCE: 5000 // mètres
    },
    
    // Missions - Collecte
    COLLECTION: {
        TIME_LIMIT: 90, // secondes
        ITEMS_TO_COLLECT: 5,
        REWARD_POINTS: 20,
        REWARD_MONEY: 15,
        COLLECTION_RADIUS: 25, // mètres
        SPAWN_RADIUS: 2000 // mètres autour du joueur
    },
    
    // Missions - Drift
    DRIFT: {
        TIME_LIMIT: 30, // secondes
        TARGET_SCORE: 1000,
        REWARD_POINTS: 120,
        REWARD_MONEY: 60,
        MIN_SPEED: 30, // km/h minimum pour compter
        DRIFT_ANGLE: 15 // degrés minimum
    },
    
    // Niveaux et déblocages
    LEVELS: {
        1: { name: "Débutant", missions: ["time_trial", "delivery"] },
        2: { name: "Apprenti", missions: ["time_trial", "delivery", "collection"] },
        3: { name: "Confirmé", missions: ["time_trial", "delivery", "collection", "drift"] },
        4: { name: "Expert", missions: ["time_trial", "delivery", "collection", "drift"] },
        5: { name: "Maître", missions: ["time_trial", "delivery", "collection", "drift"] }
    },
    
    // Interface
    UI: {
        REFRESH_RATE: 100, // ms
        NOTIFICATION_DURATION: 3000 // ms
    }
};

// ============================================
// CLASSE PRINCIPALE - MISSION MANAGER
// ============================================
class MissionManager {
    constructor(map, playerMarker) {
        this.map = map;
        this.playerMarker = playerMarker;
        this.playerPosition = null;
        
        // État du joueur
        this.playerData = this.loadProgress() || {
            level: 1,
            xp: CONFIG.STARTING_XP,
            money: CONFIG.STARTING_MONEY,
            totalMissions: 0,
            completedMissions: 0,
            highScores: {}
        };
        
        // État des missions
        this.currentMission = null;
        this.missionMarkers = [];
        this.missionTimer = null;
        this.missionStartTime = null;
        this.missionData = {};
        
        // Callbacks
        this.onMissionComplete = null;
        this.onMissionFail = null;
        this.onLevelUp = null;
        this.onUpdate = null;
        
        // Initialisation
        this.updatePlayerPosition();
        this.saveProgress();
        
        console.log(`[${CONFIG.GAME_NAME}] MissionManager initialisé - Niveau ${this.playerData.level}`);
    }
    
    // ============================================
    // GESTION DE LA PROGRESSION
    // ============================================
    
    addXP(amount) {
        this.playerData.xp += amount;
        const xpNeeded = this.getXPForLevel(this.playerData.level);
        
        if (this.playerData.xp >= xpNeeded) {
            this.levelUp();
        }
        
        this.saveProgress();
        this.showNotification(`+${amount} XP`, 'success');
    }
    
    addMoney(amount) {
        this.playerData.money += amount;
        this.saveProgress();
        this.showNotification(`+$${amount}`, 'success');
    }
    
    levelUp() {
        this.playerData.level++;
        const xpNeeded = this.getXPForLevel(this.playerData.level - 1);
        this.playerData.xp -= xpNeeded;
        
        this.showNotification(`🎉 Niveau ${this.playerData.level} atteint !`, 'levelup');
        
        if (this.onLevelUp) {
            this.onLevelUp(this.playerData.level);
        }
        
        this.saveProgress();
    }
    
    getXPForLevel(level) {
        return Math.floor(CONFIG.XP_PER_LEVEL * Math.pow(CONFIG.LEVEL_UP_MULTIPLIER, level - 1));
    }
    
    getAvailableMissions() {
        const levelData = CONFIG.LEVELS[this.playerData.level];
        return levelData ? levelData.missions : [];
    }
    
    // ============================================
    // CRÉATION DE MISSIONS
    // ============================================
    
    startMission(type) {
        if (this.currentMission) {
            this.showNotification("Une mission est déjà en cours !", 'error');
            return false;
        }
        
        const availableMissions = this.getAvailableMissions();
        if (!availableMissions.includes(type)) {
            this.showNotification(`Mission ${type} non disponible à ce niveau`, 'error');
            return false;
        }
        
        this.clearMissionMarkers();
        
        switch(type) {
            case 'time_trial':
                return this.createTimeTrialMission();
            case 'delivery':
                return this.createDeliveryMission();
            case 'collection':
                return this.createCollectionMission();
            case 'drift':
                return this.createDriftMission();
            default:
                return false;
        }
    }
    
    createTimeTrialMission() {
        const center = this.playerPosition;
        const numCheckpoints = this.randomInt(
            CONFIG.TIME_TRIAL.MIN_CHECKPOINTS,
            CONFIG.TIME_TRIAL.MAX_CHECKPOINTS
        );
        
        const checkpoints = [];
        for (let i = 0; i < numCheckpoints; i++) {
            const point = this.generateRandomPoint(center, 500 + i * 200);
            checkpoints.push(point);
            
            const marker = L.circleMarker(point, {
                radius: 10,
                color: '#ff0000',
                fillColor: '#ff0000',
                fillOpacity: 0.5
            }).addTo(this.map);
            
            marker.bindTooltip(`Checkpoint ${i + 1}/${numCheckpoints}`);
            this.missionMarkers.push(marker);
        }
        
        this.currentMission = {
            type: 'time_trial',
            checkpoints: checkpoints,
            currentCheckpoint: 0,
            totalCheckpoints: numCheckpoints,
            timeLimit: CONFIG.TIME_TRIAL.BASE_TIME + (numCheckpoints * CONFIG.TIME_TRIAL.TIME_BONUS_PER_CHECKPOINT),
            startTime: Date.now()
        };
        
        this.startTimer();
        this.showNotification(`🏁 Course contre la montre ! ${numCheckpoints} checkpoints`, 'info');
        return true;
    }
    
    createDeliveryMission() {
        const center = this.playerPosition;
        const distance = this.randomInt(
            CONFIG.DELIVERY.MIN_DISTANCE,
            CONFIG.DELIVERY.MAX_DISTANCE
        );
        
        const destination = this.generateRandomPoint(center, distance);
        
        const marker = L.circleMarker(destination, {
            radius: 15,
            color: '#00ff00',
            fillColor: '#00ff00',
            fillOpacity: 0.6
        }).addTo(this.map);
        
        marker.bindTooltip('📦 Destination');
        this.missionMarkers.push(marker);
        
        this.currentMission = {
            type: 'delivery',
            destination: destination,
            timeLimit: CONFIG.DELIVERY.TIME_LIMIT,
            startTime: Date.now()
        };
        
        this.startTimer();
        this.showNotification(`📦 Livraison ! Distance: ${Math.round(distance)}m`, 'info');
        return true;
    }
    
    createCollectionMission() {
        const center = this.playerPosition;
        const items = [];
        
        for (let i = 0; i < CONFIG.COLLECTION.ITEMS_TO_COLLECT; i++) {
            const point = this.generateRandomPoint(center, CONFIG.COLLECTION.SPAWN_RADIUS);
            items.push(point);
            
            const marker = L.circleMarker(point, {
                radius: 8,
                color: '#ffff00',
                fillColor: '#ffff00',
                fillOpacity: 0.7
            }).addTo(this.map);
            
            marker.bindTooltip(`💰 Objet ${i + 1}/${CONFIG.COLLECTION.ITEMS_TO_COLLECT}`);
            this.missionMarkers.push(marker);
        }
        
        this.currentMission = {
            type: 'collection',
            items: items,
            collected: 0,
            totalItems: CONFIG.COLLECTION.ITEMS_TO_COLLECT,
            timeLimit: CONFIG.COLLECTION.TIME_LIMIT,
            startTime: Date.now()
        };
        
        this.startTimer();
        this.showNotification(`💰 Collecte ! ${CONFIG.COLLECTION.ITEMS_TO_COLLECT} objets à récupérer`, 'info');
        return true;
    }
    
    createDriftMission() {
        this.currentMission = {
            type: 'drift',
            driftScore: 0,
            targetScore: CONFIG.DRIFT.TARGET_SCORE,
            timeLimit: CONFIG.DRIFT.TIME_LIMIT,
            startTime: Date.now(),
            isDrifting: false
        };
        
        this.startTimer();
        this.showNotification(`🏎️ Défi Drift ! Score cible: ${CONFIG.DRIFT.TARGET_SCORE}`, 'info');
        return true;
    }
    
    // ============================================
    // GESTION DES MISSIONS
    // ============================================
    
    updateMission(playerSpeed, playerHeading) {
        if (!this.currentMission) return;
        
        const elapsed = (Date.now() - this.currentMission.startTime) / 1000;
        const remaining = this.currentMission.timeLimit - elapsed;
        
        if (remaining <= 0) {
            this.failMission("Temps écoulé !");
            return;
        }
        
        switch(this.currentMission.type) {
            case 'time_trial':
                this.checkTimeTrialProgress();
                break;
            case 'delivery':
                this.checkDeliveryProgress();
                break;
            case 'collection':
                this.checkCollectionProgress();
                break;
            case 'drift':
                this.checkDriftProgress(playerSpeed, playerHeading);
                break;
        }
        
        if (this.onUpdate) {
            this.onUpdate({
                mission: this.currentMission,
                timeRemaining: remaining,
                playerData: this.playerData
            });
        }
    }
    
    checkTimeTrialProgress() {
        const checkpoint = this.currentMission.checkpoints[this.currentMission.currentCheckpoint];
        const distance = this.getDistance(this.playerPosition, checkpoint);
        
        if (distance <= CONFIG.TIME_TRIAL.CHECKPOINT_RADIUS) {
            this.currentMission.currentCheckpoint++;
            this.missionMarkers[this.currentMission.currentCheckpoint - 1].remove();
            
            if (this.currentMission.currentCheckpoint >= this.currentMission.totalCheckpoints) {
                this.completeMission();
            } else {
                this.showNotification(`✅ Checkpoint ${this.currentMission.currentCheckpoint}/${this.currentMission.totalCheckpoints}`, 'success');
            }
        }
    }
    
    checkDeliveryProgress() {
        const distance = this.getDistance(this.playerPosition, this.currentMission.destination);
        
        if (distance <= CONFIG.DELIVERY.DESTINATION_RADIUS) {
            this.completeMission();
        }
    }
    
    checkCollectionProgress() {
        for (let i = 0; i < this.currentMission.items.length; i++) {
            const item = this.currentMission.items[i];
            if (!item) continue;
            
            const distance = this.getDistance(this.playerPosition, item);
            
            if (distance <= CONFIG.COLLECTION.COLLECTION_RADIUS) {
                this.currentMission.items[i] = null;
                this.currentMission.collected++;
                this.missionMarkers[i].remove();
                
                if (this.currentMission.collected >= this.currentMission.totalItems) {
                    this.completeMission();
                } else {
                    this.showNotification(`💰 Objet collecté ! ${this.currentMission.collected}/${this.currentMission.totalItems}`, 'success');
                }
                break;
            }
        }
    }
    
    checkDriftProgress(speed, heading) {
        if (!this.currentMission.lastHeading) {
            this.currentMission.lastHeading = heading;
            return;
        }
        
        const angleDiff = Math.abs(heading - this.currentMission.lastHeading);
        const normalizedAngle = angleDiff > 180 ? 360 - angleDiff : angleDiff;
        
        if (speed >= CONFIG.DRIFT.MIN_SPEED && normalizedAngle >= CONFIG.DRIFT.DRIFT_ANGLE) {
            const driftPoints = Math.floor(normalizedAngle * (speed / 10));
            this.currentMission.driftScore += driftPoints;
            
            if (!this.currentMission.isDrifting) {
                this.currentMission.isDrifting = true;
                this.showNotification(`🏎️ DRIFT ! +${driftPoints}`, 'drift');
            }
        } else {
            this.currentMission.isDrifting = false;
        }
        
        this.currentMission.lastHeading = heading;
        
        if (this.currentMission.driftScore >= this.currentMission.targetScore) {
            this.completeMission();
        }
    }
    
    completeMission() {
        const mission = this.currentMission;
        let rewardPoints = 0;
        let rewardMoney = 0;
        let bonusXP = 0;
        
        switch(mission.type) {
            case 'time_trial':
                rewardPoints = CONFIG.TIME_TRIAL.REWARD_POINTS;
                rewardMoney = CONFIG.TIME_TRIAL.REWARD_MONEY;
                bonusXP = 50;
                break;
            case 'delivery':
                rewardPoints = CONFIG.DELIVERY.REWARD_POINTS;
                rewardMoney = CONFIG.DELIVERY.REWARD_MONEY;
                bonusXP = 60;
                break;
            case 'collection':
                rewardPoints = CONFIG.COLLECTION.REWARD_POINTS * mission.totalItems;
                rewardMoney = CONFIG.COLLECTION.REWARD_MONEY * mission.totalItems;
                bonusXP = 40;
                break;
            case 'drift':
                rewardPoints = CONFIG.DRIFT.REWARD_POINTS;
                rewardMoney = CONFIG.DRIFT.REWARD_MONEY;
                bonusXP = 55;
                break;
        }
        
        this.playerData.completedMissions++;
        this.playerData.totalMissions++;
        
        this.addXP(bonusXP);
        this.addMoney(rewardMoney);
        
        this.showMissionCompleteScreen({
            type: mission.type,
            points: rewardPoints,
            money: rewardMoney,
            xp: bonusXP,
            success: true
        });
        
        this.endMission();
        
        if (this.onMissionComplete) {
            this.onMissionComplete(mission.type);
        }
    }
    
    failMission(reason) {
        this.playerData.totalMissions++;
        
        this.showMissionCompleteScreen({
            type: this.currentMission.type,
            points: 0,
            money: 0,
            xp: 0,
            success: false,
            reason: reason
        });
        
        this.endMission();
        
        if (this.onMissionFail) {
            this.onMissionFail(reason);
        }
    }
    
    endMission() {
        this.stopTimer();
        this.clearMissionMarkers();
        this.currentMission = null;
        this.saveProgress();
    }
    
    // ============================================
    // INTERFACE UTILISATEUR
    // ============================================
    
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `game-notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 25px;
            background: ${this.getNotificationColor(type)};
            color: white;
            border-radius: 8px;
            font-weight: bold;
            z-index: 10000;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, CONFIG.UI.NOTIFICATION_DURATION);
    }
    
    getNotificationColor(type) {
        const colors = {
            success: '#28a745',
            error: '#dc3545',
            info: '#007bff',
            levelup: '#ffc107',
            drift: '#ff6b6b'
        };
        return colors[type] || colors.info;
    }
    
    showMissionCompleteScreen(data) {
        const overlay = document.createElement('div');
        overlay.className = 'mission-complete-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10001;
            animation: fadeIn 0.3s ease;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 40px;
            border-radius: 15px;
            text-align: center;
            max-width: 400px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        `;
        
        const title = data.success ? '🎉 Mission Réussie !' : '❌ Mission Échouée';
        const titleColor = data.success ? '#28a745' : '#dc3545';
        
        content.innerHTML = `
            <h2 style="color: ${titleColor}; margin-bottom: 20px;">${title}</h2>
            <p style="font-size: 18px; margin: 10px 0;">Type: <strong>${this.getMissionTypeName(data.type)}</strong></p>
            ${data.success ? `
                <div style="margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                    <p style="margin: 5px 0;">🏆 Points: <strong>${data.points}</strong></p>
                    <p style="margin: 5px 0;">💰 Argent: <strong>$${data.money}</strong></p>
                    <p style="margin: 5px 0;">⭐ XP: <strong>+${data.xp}</strong></p>
                </div>
            ` : `
                <p style="color: #dc3545; margin: 20px 0;">${data.reason}</p>
            `}
            <button onclick="this.parentElement.parentElement.remove()" style="
                padding: 12px 30px;
                background: #007bff;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                cursor: pointer;
                margin-top: 20px;
            ">Continuer</button>
        `;
        
        overlay.appendChild(content);
        document.body.appendChild(overlay);
    }
    
    getMissionTypeName(type) {
        const names = {
            time_trial: 'Course contre la montre',
            delivery: 'Livraison',
            collection: 'Collecte',
            drift: 'Défi Drift'
        };
        return names[type] || type;
    }
    
    // ============================================
    // UTILITAIRES
    // ============================================
    
    updatePlayerPosition() {
        if (this.playerMarker) {
            this.playerPosition = this.playerMarker.getLatLng();
        }
    }
    
    generateRandomPoint(center, maxDistance) {
        const angle = Math.random() * 2 * Math.PI;
        const distance = Math.random() * maxDistance;
        
        const latOffset = (distance / 111320) * Math.cos(angle);
        const lngOffset = (distance / (111320 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(angle);
        
        return L.latLng(center.lat + latOffset, center.lng + lngOffset);
    }
    
    getDistance(point1, point2) {
        return this.map.distance(point1, point2);
    }
    
    randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    
    clearMissionMarkers() {
        this.missionMarkers.forEach(marker => marker.remove());
        this.missionMarkers = [];
    }
    
    startTimer() {
        this.missionTimer = setInterval(() => {
            if (this.currentMission) {
                const elapsed = (Date.now() - this.currentMission.startTime) / 1000;
                const remaining = this.currentMission.timeLimit - elapsed;
                
                if (remaining <= 0) {
                    this.failMission("Temps écoulé !");
                }
            }
        }, 1000);
    }
    
    stopTimer() {
        if (this.missionTimer) {
            clearInterval(this.missionTimer);
            this.missionTimer = null;
        }
    }
    
    // ============================================
    // SAUVEGARDE
    // ============================================
    
    saveProgress() {
        try {
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.playerData));
        } catch (e) {
            console.error('Erreur de sauvegarde:', e);
        }
    }
    
    loadProgress() {
        try {
            const data = localStorage.getItem(CONFIG.SAVE_KEY);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error('Erreur de chargement:', e);
            return null;
        }
    }
    
    resetProgress() {
        if (confirm('Êtes-vous sûr de vouloir réinitialiser toute la progression ?')) {
            localStorage.removeItem(CONFIG.SAVE_KEY);
            this.playerData = {
                level: 1,
                xp: CONFIG.STARTING_XP,
                money: CONFIG.STARTING_MONEY,
                totalMissions: 0,
                completedMissions: 0,
                highScores: {}
            };
            this.saveProgress();
            this.showNotification('Progression réinitialisée', 'info');
        }
    }
    
    // ============================================
    // GETTERS
    // ============================================
    
    getPlayerData() {
        return { ...this.playerData };
    }
    
    getCurrentMission() {
        return this.currentMission ? { ...this.currentMission } : null;
    }
    
    isMissionActive() {
        return this.currentMission !== null;
    }
}

// ============================================
// STYLES CSS POUR LES ANIMATIONS
// ============================================
const styles = document.createElement('style');
styles.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
    
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
`;
document.head.appendChild(styles);

// ============================================
// EXPORT DU MODULE
// ============================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MissionManager, CONFIG };
}

// ============================================
// EXEMPLE D'UTILISATION
// ============================================
/*
// Initialisation de la carte Leaflet
const map = L.map('map').setView([48.8566, 2.3522], 15); // Paris

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Marqueur du joueur (à mettre à jour avec la position réelle)
const playerMarker = L.marker([48.8566, 2.3522]).addTo(map);

// Initialisation du MissionManager
const missionManager = new MissionManager(map, playerMarker);

// Callbacks optionnels
missionManager.onMissionComplete = (type) => {
    console.log(`Mission ${type} terminée !`);
};

missionManager.onLevelUp = (level) => {
    console.log(`Niveau ${level} atteint !`);
};

missionManager.onUpdate = (data) => {
    // Mise à jour de l'interface utilisateur
    console.log(`Temps restant: ${data.timeRemaining.toFixed(1)}s`);
};

// Mise à jour de la position du joueur (à appeler régulièrement)
setInterval(() => {
    missionManager.updatePlayerPosition();
    
    // Simuler des données de véhicule (à remplacer par les vraies données)
    const playerSpeed = 50; // km/h
    const playerHeading = 45; // degrés
    
    missionManager.updateMission(playerSpeed, playerHeading);
}, CONFIG.UI.REFRESH_RATE);

// Démarrer une mission
// missionManager.startMission('time_trial');
// missionManager.startMission('delivery');
// missionManager.startMission('collection');
// missionManager.startMission('drift');

// Afficher les stats
// console.log(missionManager.getPlayerData());
*/