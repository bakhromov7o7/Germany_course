const { query, withTransaction } = require("../db");

async function saveVideoMaterial({
  topicId,
  uploadedByUserId,
  title,
  telegramFileId,
  telegramFileUniqueId,
  sourceChatId,
  sourceMessageId,
}) {
  const result = await query(
    `
      insert into topic_materials (
        topic_id,
        uploaded_by_user_id,
        material_type,
        title,
        telegram_file_id,
        telegram_file_unique_id,
        source_chat_id,
        source_message_id
      )
      values ($1, $2, 'video', $3, $4, $5, $6, $7)
      returning *
    `,
    [topicId, uploadedByUserId, title || null, telegramFileId, telegramFileUniqueId, sourceChatId, sourceMessageId],
  );

  return result.rows[0];
}

async function saveTextMaterial({
  topicId,
  uploadedByUserId,
  title,
  rawText,
  processedText,
  chunks,
  materialType = "text",
}) {
  return withTransaction(async (client) => {
    const materialResult = await client.query(
      `
        insert into topic_materials (
          topic_id,
          uploaded_by_user_id,
          material_type,
          title,
          raw_text,
          processed_text
        )
        values ($1, $2, $3::material_type, $4, $5, $6)
        returning *
      `,
      [topicId, uploadedByUserId, materialType, title || null, rawText, processedText],
    );

    const material = materialResult.rows[0];

    for (let index = 0; index < chunks.length; index += 1) {
      await client.query(
        `
          insert into knowledge_chunks (
            topic_id,
            material_id,
            chunk_index,
            chunk_text
          )
          values ($1, $2, $3, $4)
        `,
        [topicId, material.id, index, chunks[index]],
      );
    }

    return material;
  });
}

async function getTopicVideos(topicId) {
  const result = await query(
    `
      select *
      from topic_materials
      where topic_id = $1
        and material_type = 'video'
      order by id asc
    `,
    [topicId],
  );

  return result.rows;
}

async function getKnowledgeChunks(topicId) {
  const result = await query(
    `
      select chunk_text
      from knowledge_chunks
      where topic_id = $1
      order by material_id asc nulls last, chunk_index asc
    `,
    [topicId],
  );

  return result.rows.map((row) => row.chunk_text);
}

module.exports = {
  getKnowledgeChunks,
  getTopicVideos,
  saveTextMaterial,
  saveVideoMaterial,
};
