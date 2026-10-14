/* Réglages du site Les Lauriers — seul fichier à modifier pour brancher la réservation.
   Voir RESERVATION-AGENDA.md pour créer le scénario Make (webhook -> Google Agenda). */
window.LAURIERS = {
  /* true = démonstration : disponibilités d'exemple, aucune demande envoyée.
     Passer à false une fois les deux adresses ci-dessous renseignées. */
  DEMO_MODE: true,

  /* Adresse du webhook Make qui REÇOIT les demandes (POST, JSON) et crée l'événement dans Google Agenda. */
  BOOKING_WEBHOOK: '',

  /* Adresse du webhook Make qui RENVOIE les nuits déjà prises (GET ?from=AAAA-MM-JJ&to=AAAA-MM-JJ)
     au format {"busy":[["2026-11-03","2026-11-06"], ...]} (arrivée incluse, départ exclu). */
  AVAILABILITY_URL: '',

  /* Contact de l'hôte (fiche Google / office de tourisme de Moustiers). */
  HOST_NAME: 'Aude',
  PHONE_DISPLAY: '06 81 46 32 46',
  PHONE_TEL: '+33681463246',
  PHONE_2_DISPLAY: '04 92 78 07 59',
  ADDRESS: '162 chemin de Quinson, 04360 Moustiers-Sainte-Marie',
  LAT: 43.841886,
  LNG: 6.21811,
  CHECKIN: '15:00',
  CHECKOUT: '10:30',

  /* Séjour */
  MIN_NIGHTS: 1,
  MAX_NIGHTS: 14,
  MAX_GUESTS: 3,            // 2 + 1 personne supplémentaire sur demande
  BASE_GUESTS: 2,
  EXTRA_GUEST_PER_NIGHT: 15,
  MONTHS_AHEAD: 14,

  /* Tarifs indicatifs par nuit (office de tourisme : 65 à 95 € ; Google : 75 € fin octobre).
     Format MM-JJ ; une saison peut enjamber le 1er janvier. À valider avec l'hôte. */
  SEASONS: [
    { from: '07-01', to: '08-31', rate: 95, label: 'Été' },
    { from: '04-01', to: '06-30', rate: 75, label: 'Printemps' },
    { from: '09-01', to: '10-31', rate: 75, label: 'Automne' },
    { from: '11-01', to: '03-31', rate: 65, label: 'Hiver' }
  ]
};
