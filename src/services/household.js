const pool = require('../../db/pool');

/**
 * Resolves which account's children/subscription a user should act on.
 * An accepted household member operates on their household owner's data;
 * anyone else (including the owner themselves) acts on their own account.
 */
async function getEffectiveOwnerId(userId) {
  const result = await pool.query(
    `SELECT owner_user_id FROM household_members
     WHERE member_user_id = $1 AND status = 'accepted' LIMIT 1`,
    [userId]
  );
  return result.rows[0]?.owner_user_id ?? userId;
}

/**
 * True if this user is an accepted member of someone else's household
 * (as opposed to being an owner acting on their own account). Members
 * can manage children but never touch billing.
 */
async function isHouseholdMember(userId) {
  const ownerId = await getEffectiveOwnerId(userId);
  return ownerId !== userId;
}

module.exports = { getEffectiveOwnerId, isHouseholdMember };
