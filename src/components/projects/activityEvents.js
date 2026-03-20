export const ACTIVITY_TYPES = {
  cardMoved: 'card_moved',
  cardRenamed: 'card_renamed',
  commentAdded: 'comment_added',
  attachmentAdded: 'attachment_added',
};

export async function logCardActivity(event) {
  if (!event?.card_id || !event?.type) return;
  return;
}
