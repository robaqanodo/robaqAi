import {expect, it} from 'vitest'
import {youtubeId, queryIds, shareUrl} from '../src/music/queue'
const id='dQw4w9WgXcQ'
it('accepts IDs and supported YouTube link forms, ignoring extra parameters',()=>{
 for(const value of [id,`https://youtu.be/${id}?si=abc`,...['www.youtube.com','m.youtube.com','music.youtube.com'].map(h=>`https://${h}/watch?v=${id}&list=123`),...['shorts','embed','live','v'].map(p=>`https://youtube.com/${p}/${id}?t=30`)])expect(youtubeId(value)).toBe(id)
})
it('rejects unrelated hosts and malformed IDs, and shares only validated IDs',()=>{
 for(const value of ['', 'bad', `https://youtube.com.evil.test/watch?v=${id}`, `https://example.com/${id}`])expect(youtubeId(value)).toBeNull()
 expect(queryIds(`?ids=bad,${id},nope`)).toEqual([id])
 expect(shareUrl([id,'bad'])).toBe(`https://robaq.app/play?ids=${id}`)
})
