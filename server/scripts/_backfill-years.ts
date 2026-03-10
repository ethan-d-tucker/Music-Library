/**
 * Backfill album years into audio file tags.
 * Reads year from a curated mapping, writes DATE (FLAC) or year (MP3) tags.
 * Navidrome picks up the changes on its next scan.
 *
 * Usage: cd server && npx tsx scripts/_backfill-years.ts [--dry-run]
 */
import fs from 'fs'
import path from 'path'
import NodeID3 from 'node-id3'
import { execFile } from 'child_process'
import { promisify } from 'util'
import Database from 'better-sqlite3'
import { MUSIC_DIR, FFMPEG_DIR } from '../src/config.js'

const execFileAsync = promisify(execFile)
const ffmpegPath = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffmpeg').replace(/\\/g, '/') : 'ffmpeg'
const ffprobePath = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffprobe').replace(/\\/g, '/') : 'ffprobe'
const dryRun = process.argv.includes('--dry-run')

// [albumPattern, artistPattern, year] — albumPattern matched with includes(), artistPattern with includes()
// artistPattern '' matches any artist
const yearMap: [string, string, number][] = [
  // Sturgill Simpson
  ['High Top Mountain', 'Sturgill Simpson', 2013],
  ['Metamodern Sounds in Country Music', 'Sturgill Simpson', 2014],
  ['A Sailor\'s Guide to Earth', 'Sturgill Simpson', 2016],
  ['SOUND & FURY', 'Sturgill Simpson', 2019],
  ['Cuttin\' Grass Vol. 1', 'Sturgill Simpson', 2020],
  ['Cuttin\' Grass Vol. 2', 'Sturgill Simpson', 2020],
  ['The Ballad of Dood & Juanita', 'Sturgill Simpson', 2021],
  ['Passage Du Desir', 'Johnny Blue Skies', 2024],
  ['Mutiny After Midnight', 'Johnny Blue Skies', 2026],

  // Jason Isbell (solo)
  ['Sirens of the Ditch', 'Jason Isbell', 2007],
  ['Southeastern', 'Jason Isbell', 2013],
  ['Something More Than Free', 'Jason Isbell', 2015],
  ['Foxes in the Snow', 'Jason Isbell', 2025],
  // Jason Isbell and the 400 Unit
  ['Here We Rest', 'Jason Isbell', 2011],
  ['Jason Isbell And The 400 Unit', 'Jason Isbell', 2009],
  ['The Nashville Sound', 'Jason Isbell', 2017],
  ['Reunions', 'Jason Isbell', 2020],
  ['Weathervanes', 'Jason Isbell', 2023],
  ['Georgia Blue', 'Jason Isbell', 2021],
  ['Live from the Ryman, Vol. 2', 'Jason Isbell', 2024],

  // Turnpike Troubadours
  ['Bossier City', 'Turnpike Troubadours', 2007],
  ['Diamonds & Gasoline', 'Turnpike Troubadours', 2010],
  ['Goodbye Normal Street', 'Turnpike Troubadours', 2012],
  ['The Turnpike Troubadours', 'Turnpike Troubadours', 2015],
  ['A Long Way From Your Heart', 'Turnpike Troubadours', 2017],
  ['A Cat in the Rain', 'Turnpike Troubadours', 2023],
  ['The Price of Admission', 'Turnpike Troubadours', 2025],
  ['Come as You Are', 'Turnpike Troubadours', 2023],
  ['Old Time Feeling', 'Turnpike Troubadours', 2017],
  ['Pipe Bomb Dream', 'Turnpike Troubadours', 2017],
  ['Sunday Morning Paper', 'Turnpike Troubadours', 2017],
  ['The Bird Hunters', 'Turnpike Troubadours', 2010],

  // Tyler Childers
  ['Bottles and Bibles', 'Tyler Childers', 2011],
  ['Purgatory', 'Tyler Childers', 2017],
  ['Country Squire', 'Tyler Childers', 2019],
  ['Long Violent History', 'Tyler Childers', 2020],
  ['Can I Take My Hounds to Heaven?', 'Tyler Childers', 2022],
  ['Rustin\' in the Rain', 'Tyler Childers', 2023],
  ['Snipe Hunter', 'Tyler Childers', 2025],
  ['All Your\'n', 'Tyler Childers', 2019],
  ['In Your Love', 'Tyler Childers', 2023],
  ['Angel Band', 'Tyler Childers', 2023],
  ['Jersey Giant', 'Tyler Childers', 2019],
  ['Nose on the Grindstone', 'Tyler Childers', 2017],
  ['Oneida', 'Tyler Childers', 2023],
  ['Reimagined', 'Tyler Childers', 2023],
  ['Back in the Barn', 'Tyler Childers', 2023],

  // Trampled by Turtles
  ['Songs From a Ghost Town', 'Trampled by Turtles', 2004],
  ['Blue Sky and the Devil', 'Trampled by Turtles', 2005],
  ['Trouble', 'Trampled by Turtles', 2007],
  ['Duluth', 'Trampled by Turtles', 2008],
  ['Palomino', 'Trampled by Turtles', 2010],
  ['Stars and Satellites', 'Trampled by Turtles', 2012],
  ['Wild Animals', 'Trampled by Turtles', 2014],
  ['Life Is Good on the Open Road', 'Trampled by Turtles', 2018],
  ['Alpenglow', 'Trampled by Turtles', 2022],
  ['Live at First Avenue', 'Trampled by Turtles', 2013],
  ['Live at Red Rocks', 'Trampled by Turtles', 2021],
  ['Burn for Free', 'Trampled by Turtles', 2005],
  ['Always Here', 'Trampled by Turtles', 2024],
  ['Fake Plastic Trees', 'Trampled by Turtles', 2014],
  ['Live at Luce', 'Trampled by Turtles', 2011],

  // The Avett Brothers
  ['Country Was', 'The Avett Brothers', 2002],
  ['A Carolina Jubilee', 'The Avett Brothers', 2003],
  ['Mignonette', 'The Avett Brothers', 2004],
  ['Four Thieves Gone', 'The Avett Brothers', 2006],
  ['Emotionalism', 'The Avett Brothers', 2007],
  ['I and Love and You', 'The Avett Brothers', 2009],
  ['The Carpenter', 'The Avett Brothers', 2012],
  ['Magpie and the Dandelion', 'The Avett Brothers', 2013],
  ['True Sadness', 'The Avett Brothers', 2016],
  ['Closer Than Together', 'The Avett Brothers', 2019],
  ['Back Into the Light', 'The Avett Brothers', 2020],
  ['The Avett Brothers', 'The Avett Brothers', 2024],

  // Chappell Roan
  ['School Nights', 'Chappell Roan', 2017],
  ['The Rise and Fall of a Midwest Princess', 'Chappell Roan', 2023],
  ['Good Hurt', 'Chappell Roan', 2017],
  ['Bitter', 'Chappell Roan', 2018],
  ['Pink Pony Club', 'Chappell Roan', 2020],
  ['Love Me Anyway', 'Chappell Roan', 2020],
  ['California', 'Chappell Roan', 2020],
  ['Naked in Manhattan', 'Chappell Roan', 2022],
  ['Femininomenon', 'Chappell Roan', 2023],
  ['Red Wine Supernova', 'Chappell Roan', 2023],
  ['Casual', 'Chappell Roan', 2023],
  ['HOT TO GO!', 'Chappell Roan', 2023],
  ['My Kink Is Karma', 'Chappell Roan', 2023],
  ['Kaleidoscope', 'Chappell Roan', 2023],
  ['Good Luck, Babe!', 'Chappell Roan', 2024],
  ['The Giver', 'Chappell Roan', 2025],
  ['The Subway', 'Chappell Roan', 2025],
  ['The Subway / The Giver', 'Chappell Roan', 2025],
  ['Cleopatra', 'Chappell Roan', 2017],
  ['Kayleigh Rose', 'Chappell Roan', 2015],
  ['NPR Music Tiny Desk Concert', 'Chappell Roan', 2024],
  ['City Sessions', 'Chappell Roan', 2024],
  ['Live at Lollapalooza', 'Chappell Roan', 2024],
  ['Roan Unreleased', 'Chappell Roan', 2020],
  ['The Midwest Princess Demos', 'Chappell Roan', 2023],

  // Dan Reeder
  ['Dan Reeder', 'Dan Reeder', 2004],
  ['Sweetheart', 'Dan Reeder', 2006],
  ['this new century', 'Dan Reeder', 2010],
  ['Every Which Way', 'Dan Reeder', 2020],
  ['Smithereens', 'Dan Reeder', 2024],
  ['EP X 500', 'Dan Reeder', 2002],
  ['Nice Clear Bright Colors', 'Dan Reeder', 2002],
  ['Nobody Wants to Be You', 'Dan Reeder', 2017],
  ['52 years ago', 'Dan Reeder', 2020],
  ['Feather', 'Dan Reeder', 2020],
  ['Love & Hate', 'Dan Reeder', 2020],

  // Hozier
  ['Hozier', 'Hozier', 2014],
  ['Wasteland, Baby!', 'Hozier', 2019],
  ['Unreal Unearth', 'Hozier', 2023],

  // Rainbow Kitten Surprise
  ['Seven + Mary', 'Rainbow Kitten Surprise', 2015],
  ['RKS', 'Rainbow Kitten Surprise', 2015],
  ['How to: Friend, Love, Freefall', 'Rainbow Kitten Surprise', 2018],
  ['Love Hate Music Box', 'Rainbow Kitten Surprise', 2024],

  // Olivia Rodrigo
  ['SOUR', 'Olivia Rodrigo', 2021],
  ['GUTS', 'Olivia Rodrigo', 2023],
  ['FUME', 'Olivia Rodrigo', 2026],

  // Sabrina Carpenter
  ['Eyes Wide Open', 'Sabrina Carpenter', 2015],
  ['EVOLution', 'Sabrina Carpenter', 2016],
  ['Singular: Act I', 'Sabrina Carpenter', 2018],
  ['Short n\' Sweet', 'Sabrina Carpenter', 2024],

  // Merle Haggard
  ['Strangers', 'Merle Haggard', 1965],
  ['I\'m a Lonesome Fugitive', 'Merle Haggard', 1967],
  ['Branded Man', 'Merle Haggard', 1967],
  ['Sing Me Back Home', 'Merle Haggard', 1968],
  ['Mama Tried', 'Merle Haggard', 1968],
  ['Pride in What I Am', 'Merle Haggard', 1969],
  ['A Portrait Of', 'Merle Haggard', 1969],
  ['Same Train, a Different Time', 'Merle Haggard', 1969],
  ['Swinging Doors', 'Merle Haggard', 1966],
  ['The Legend of Bonnie & Clyde', 'Merle Haggard', 1968],
  ['A Tribute to the Best Damn Fiddle Player', 'Merle Haggard', 1970],
  ['Hag', 'Merle Haggard', 1971],
  ['Someday We\'ll Look Back', 'Merle Haggard', 1971],
  ['Introducing My Friends The Strangers', 'Merle Haggard', 1970],
  ['Getting to Know', 'Merle Haggard', 1970],
  ['Honky Tonkin', 'Merle Haggard', 1971],
  ['Totally Instrumental', 'Merle Haggard', 1973],
  ['Merle Haggard\'s Christmas Present', 'Merle Haggard', 1973],
  ['It\'s All in the Movies', 'Merle Haggard', 1975],
  ['The Roots of My Raising', 'Merle Haggard', 1976],
  ['My Love Affair With Trains', 'Merle Haggard', 1976],
  ['Back to the Barrooms', 'Merle Haggard', 1980],
  ['A Friend in California', 'Merle Haggard', 1986],
  ['5:01 Blues', 'Merle Haggard', 1989],
  ['1994', 'Merle Haggard', 1994],
  ['1996', 'Merle Haggard', 1996],
  ['Chicago Wind', 'Merle Haggard', 2005],
  ['Just Between the Two of Us', '', 1966],
  ['Kickin\' Out the Footlights', '', 2006],
  ['The Bob Dylan Show', 'Merle Haggard', 2005],
  ['Reflections', 'Merle Haggard', 2001],
  ['American Music Legends', 'Merle Haggard', 2003],
  ['Country Legend', 'Merle Haggard', 2002],
  ['Country Legends', 'Merle Haggard', 2002],
  ['Country Roads', 'Merle Haggard', 2005],
  ['Lonesome Fugitive', 'Merle Haggard', 2001],
  ['Country\'s Bad Boys', '', 2004],
  ['Hag: The Best of Merle Haggard', 'Merle Haggard', 2006],
  ['The Top Hits of Country\'s Original Outlaw', 'Merle Haggard', 2005],
  ['Down Every Road Sampler', 'Merle Haggard', 1996],
  ['Down Every Road', 'Merle Haggard', 1996],
  ['18 Greatest', 'Merle Haggard', 2002],
  ['20 #1 Hits', 'Merle Haggard', 2002],
  ['20 Hits, Volume 2', 'Merle Haggard', 2002],
  ['24 at No.1', 'Merle Haggard', 2002],
  ['25th Anniversary Album', 'Merle Haggard', 1990],
  ['#1 Hits', 'Merle Haggard', 2002],
  ['5 Classic Albums', 'Merle Haggard', 2014],
  ['Greatest No. 1 Hits', 'Merle Haggard', 2002],
  ['Live From Austin, TX', 'Merle Haggard', 2006],
  ['Live: The Hits and More', 'Merle Haggard', 2007],

  // Keith Whitley
  ['Don\'t Close Your Eyes', 'Keith Whitley', 1988],
  ['2nd Generation Bluegrass', 'Keith Whitley', 1971],
  ['Tribute To The Stanley Brothers', 'Keith Whitley', 1971],
  ['Sad Songs And Waltzes', 'Keith Whitley', 2005],

  // SteelDrivers
  ['The SteelDrivers', 'SteelDrivers', 2008],
  ['Reckless', 'Steeldrivers', 2010],
  ['Hammer Down', 'SteelDrivers', 2012],

  // The Highwomen
  ['The Highwomen', 'The Highwomen', 2019],

  // Randy Travis
  ['Storms of Life', 'Randy Travis', 1986],
  ['Always & Forever', 'Randy Travis', 1987],
  ['Old 8x10', 'Randy Travis', 1988],
  ['Old 8 x 10', 'Randy Travis', 1988],

  // Pure Prairie League
  ['Pure Prairie League', 'Pure Prairie League', 1972],
  ['Bustin\' Out', 'Pure Prairie League', 1972],

  // Adele
  ['19', 'Adele', 2008],
  ['25', 'Adele', 2015],
  ['88', 'Adele', 2009],

  // Creedence Clearwater Revival
  ['Chronicle', 'Creedence Clearwater Revival', 1976],
  ['Cosmo\'s Factory', 'Creedence Clearwater Revival', 1970],

  // John Prine
  ['John Prine', 'John Prine', 1971],
  ['Bruised Orange', 'John Prine', 1978],
  ['Fair and Square', 'John Prine', 2005],
  ['The Tree of Forgiveness', 'John Prine', 2018],

  // Nirvana
  ['In Utero', 'Nirvana', 1993],
  ['MTV Unplugged In New York', 'Nirvana', 1994],

  // Taylor Swift
  ['Midnights', 'Taylor Swift', 2022],
  ['THE TORTURED POETS DEPARTMENT', 'Taylor Swift', 2024],
  ['The Life of a Showgirl', 'Taylor Swift', 2025],

  // Pearl Jam
  ['Ten', 'Pearl Jam', 1991],
  ['Vs.', 'Pearl Jam', 1993],
  ['Jeremy', 'Pearl Jam', 1992],
  ['Last Kiss', 'Pearl Jam', 1999],

  // Soundgarden
  ['Badmotorfinger', 'Soundgarden', 1991],
  ['Superunknown', 'Soundgarden', 1994],
  ['Down On The Upside', 'Soundgarden', 1996],

  // Billie Eilish
  ['HIT ME HARD AND SOFT', 'Billie Eilish', 2024],
  ['What Was I Made For', 'Billie Eilish', 2023],

  // Lana Del Rey
  ['Born To Die', 'Lana Del Rey', 2012],

  // Olivia Dean
  ['Messy', 'Olivia Dean', 2023],
  ['Man I Need', 'Olivia Dean', 2024],
  ['Nice To Each Other', 'Olivia Dean', 2024],
  ['The Art of Loving', 'Olivia Dean', 2024],
  ['This Wasn\'t Meant For You Anyway', 'Lola Young', 2024],

  // Don Williams
  ['Expressions', 'Don Williams', 1978],
  ['I Believe In You', 'Don Williams', 1980],
  ['Visions', 'Don Williams', 1977],

  // Drive-By Truckers
  ['Decoration Day', 'Drive-By Truckers', 2003],
  ['The Dirty South', 'Drive-By Truckers', 2004],
  ['The Complete Dirty South', 'Drive-By Truckers', 2004],

  // Gillian Welch
  ['Revival', 'Gillian Welch', 1996],
  ['Soul Journey', 'Gillian Welch', 2003],
  ['The Harrow & The Harvest', 'Gillian Welch', 2011],

  // Guy Clark
  ['Old No. 1', 'Guy Clark', 1975],
  ['Texas Cookin', 'Guy Clark', 1976],
  ['Dublin Blues', 'Guy Clark', 1995],

  // Vince Gill
  ['When I Call Your Name', 'Vince Gill', 1989],
  ['I Still Believe In You', 'Vince Gill', 1992],
  ['What You Give Away', 'Vince Gill', 2006],

  // Jim Croce
  ['You Don\'t Mess Around With Jim', 'Jim Croce', 1972],

  // Townes Van Zandt
  ['Townes Van Zandt', 'Townes Van Zandt', 1969],
  ['Roadsongs', 'Townes Van Zandt', 1994],

  // Djo
  ['DECIDE', 'Djo', 2022],
  ['The Crux', 'Djo', 2024],

  // Warren Zevon
  ['Warren Zevon', 'Warren Zevon', 1976],
  ['Life\'ll Kill Ya', 'Warren Zevon', 2000],

  // George Strait
  ['Strait From The Heart', 'George Strait', 1982],
  ['Blue Clear Sky', 'George Strait', 1996],

  // Chris Stapleton
  ['From A Room: Volume 1', 'Chris Stapleton', 2017],
  ['From A Room: Volume 2', 'Chris Stapleton', 2017],
  ['Starting Over', 'Chris Stapleton', 2020],

  // Noah Kahan
  ['Stick Season', 'Noah Kahan', 2022],

  // Lorde
  ['Pure Heroine', 'Lorde', 2013],

  // Temple Of The Dog
  ['Temple Of The Dog', 'Temple Of The Dog', 1991],

  // Bob Dylan
  ['The Freewheelin\' Bob Dylan', 'Bob Dylan', 1963],
  ['The Times They Are A-Changin\'', 'Bob Dylan', 1964],
  ['Bringing It All Back Home', 'Bob Dylan', 1965],
  ['Blood On The Tracks', 'Bob Dylan', 1975],
  ['New Morning', 'Bob Dylan', 1970],
  ['The Basement Tapes Complete', 'Bob Dylan', 2014],

  // Neil Young
  ['After the Gold Rush', 'Neil Young', 1970],
  ['Harvest', 'Neil Young', 1972],
  ['Zuma', 'Neil Young', 1975],
  ['Rust Never Sleeps', 'Neil Young', 1979],
  ['Harvest Moon', 'Neil Young', 1992],
  ['Greatest Hits', 'Neil Young', 2004],

  // O Brother Where Art Thou
  ['O Brother, Where Art Thou', '', 2000],

  // Misc single-album artists
  ['Mellow Gold', 'Beck', 1994],
  ['Fireworks & Rollerblades', 'Benson Boone', 2024],
  ['Stranger In Town', 'Bob Seger', 1978],
  ['The Firewatcher\'s Daughter', 'Brandi Carlile', 2015],
  ['Razorblade Suitcase', 'Bush', 1996],
  ['Sixteen Stone', 'Bush', 1994],
  ['Imaginary Appalachia', 'Colter Wall', 2015],
  ['Crosby, Stills & Nash', 'Crosby', 1969],
  ['Deja Vu', 'Crosby', 1970],
  ['A Friend Of A Friend', 'Dave Rawlings', 2009],
  ['Once Upon a Rhyme', 'David Allan Coe', 1975],
  ['Alligator Bites Never Heal', 'Doechii', 2024],
  ['So Much For The Afterglow', 'Everclear', 1997],
  ['Flatland Forever', 'Flatland Cavalry', 2024],
  ['Rumours', 'Fleetwood Mac', 1977],
  ['13 Songs', 'Fugazi', 1989],
  ['Godsmack', 'Godsmack', 1998],
  ['Make Yourself', 'Incubus', 1999],
  ['Nothing\'s Shocking', 'Jane\'s Addiction', 1988],
  ['Rose Colored Glasses', 'John Conlee', 1978],
  ['Depreciated', 'John R. Miller', 2018],
  ['Not Like Us', 'Kendrick Lamar', 2024],
  ['How Lucky', 'Kurt Vile', 2020],
  ['Crying Laughing Loving Lying', 'Labi Siffre', 1972],
  ['MAYHEM', 'Lady Gaga', 2025],
  ['Throwing Copper', 'Live', 1994],
  ['As Good As Dead', 'Local H', 1996],
  ['Kala', 'M.I.A.', 2007],
  ['Marcy Playground', 'Marcy Playground', 1997],
  ['Endless Summer Vacation', 'Miley Cyrus', 2023],
  ['Tragic Kingdom', 'No Doubt', 1995],
  ['Tales From The Punchbowl', 'Primus', 1995],
  ['Songs For The Deaf', 'Queens of the Stone Age', 2002],
  ['Gossip In The Grain', 'Ray LaMontagne', 2008],
  ['Greatest Hits', 'Red Hot Chili Peppers', 2003],
  ['Sixpence None The Richer', 'Sixpence None The Richer', 1997],
  ['Core', 'Stone Temple Pilots', 1992],
  ['Purple', 'Stone Temple Pilots', 1994],
  ['Sublime', 'Sublime', 1996],
  ['Can\'t Buy A Thrill', 'Steely Dan', 1972],
  ['Third Eye Blind', 'Third Eye Blind', 1997],
  ['Greatest Hits', 'Tom Petty', 1993],
  ['Lemon Parade', 'Tonic', 1996],
  ['Tomorrow The Green Grass', 'The Jayhawks', 1995],
  ['Tea For The Tillerman', '', 1970],
  ['Everybody Else Is Doing It', 'The Cranberries', 1993],
  ['Music From Big Pink', 'The Band', 1968],
  ['First Band On The Moon', 'The Cardigans', 1996],
  ['Mellon Collie', 'The Smashing Pumpkins', 1995],
  ['Weezer', 'Weezer', 1994],
  ['Wheatus', 'Wheatus', 2000],
  ['Heroes', 'Willie Nelson', 2012],
  ['Bookends', 'Simon & Garfunkel', 1968],
  ['Bridge Over Troubled Water', 'Simon & Garfunkel', 1970],
  ['Cold Beer & Country Music', 'Zach Top', 2024],
  ['Summertime Blues', 'Zach Bryan', 2024],
  ['Moondance', 'Van Morrison', 1970],
  ['Goblin', 'Tyler, The Creator', 2011],
  ['Long Journey', 'Michael Hurley', 2001],
  ['Bound to Rain', 'Ken Pomeroy', 2020],
  ['Cruel Joke', 'Ken Pomeroy', 2021],
  ['Rock Salt And Nails', 'Steve Young', 1969],
  ['Whats Going On', 'Marvin Gaye', 1971],
  ['At The Beach', 'Gigi Perez', 2024],
  ['Blaze Foley', 'Blaze Foley', 1999],
  ['Oval Room', 'Blaze Foley', 1999],
  ['Live at the Austin Outhouse', 'Blaze Foley', 1999],
  ['The Dawg Years', 'Blaze Foley', 2011],
  ['Alan Sparhawk', 'Alan Sparhawk', 2024],
  ['Dirt', 'Alice In Chains', 1992],
  ['Jar Of Flies', 'Alice In Chains', 1994],
  ['Back Home In Sulphur Springs', 'Norman Blake', 2003],
  ['Mt. Joy', 'Mt. Joy', 2018],
  ['Jenny Jenkins', 'Mt. Joy', 2023],
  ['Live at The Salt Shed', 'Mt. Joy', 2024],
  ['Darrell Scott', 'Darrell Scott', 2000],
  ['Live In NC', 'Darrell Scott', 2009],
  ['Live at the Shoals Theatre', '', 2016],
  ['Justin Townes Earle', 'Justin Townes Earle', 2007],
  ['Live in Seattle', 'Justin Townes Earle', 2011],
  ['Kendrick Lamar EP', 'Kendrick Lamar', 2009],

  // Kanye West
  ['The College Dropout', 'Kanye West', 2004],
  ['Late Registration', 'Kanye West', 2005],
  ['Graduation', 'Kanye West', 2007],
  ['808s & Heartbreak', 'Kanye West', 2008],
  ['My Beautiful Dark Twisted Fantasy', 'Kanye West', 2010],
  ['Black Panther', 'Kendrick Lamar', 2018],

  // Tony Rice
  ['Church Street Blues', 'Tony Rice', 1983],

  // Folder-name edge cases
  ['501 Blues', 'Merle Haggard', 1989],
  ['Someday We\u2019ll Look Back', 'Merle Haggard', 1971],
  ['Tribute to the Best Damn Fiddle', 'Merle Haggard', 1970],
  ['Top Hits of Country', 'Merle Haggard', 2005],
  ['Live The Hits and More', 'Merle Haggard', 2007],
  ['From A Room Volume 1', 'Chris Stapleton', 2017],
  ['From A Room Volume 2', 'Chris Stapleton', 2017],
  ['Sailor\'s Guide to Earth', 'Sturgill Simpson', 2016],
  ['Butcher Shoppe Sessions', 'Sturgill Simpson', 2020],
  ['Cowboy Arms Sessions', 'Sturgill Simpson', 2020],
  ['How to Friend, Love, Freefall', 'Rainbow Kitten Surprise', 2018],
  ['Singular Act I', 'Sabrina Carpenter', 2018],
  ['Can I Take My Hounds to Heaven', 'Tyler Childers', 2022],
  ['Rustin\u2019 in the Rain', 'Tyler Childers', 2023],
  ['Bitin\' List', 'Tyler Childers', 2019],
  ['Going Home', 'Tyler Childers', 2020],
  ['Live on Red Barn Radio', 'Tyler Childers', 2018],
  ['Apple Music Nashville Sessions', 'Turnpike Troubadours', 2023],
  ['Live AF Session', 'Turnpike Troubadours', 2022],
  ['Maybe It\'s Time', 'Jason Isbell', 2018],
  ['Live at the Beacon Theatre', 'Jason Isbell', 2025],
  ['Live at Roundhouse', 'Jason Isbell', 2020],
  ['Live from Welcome to 1979', 'Jason Isbell', 2021],
  ['Live at Macon City', 'Jason Isbell', 2021],
  ['Live at Red Rocks', 'Jason Isbell', 2022],
  ['Live at the Georgia Theatre', 'Jason Isbell', 2020],
  ['Live at the Ryman Auditorium', 'Jason Isbell', 2020],
  ['Live at the Tabernacle', 'Jason Isbell', 2022],
  ['Live at The Bend', 'Jason Isbell', 2020],
  ['Vs', 'Pearl Jam', 1993],
  ['M.I.A', 'M.I.A', 2007],
  ['Kickin\u2019 Out the Footlights', '', 2006],

  // Last edge cases
  ['Red Rocks (Live)', 'Jason Isbell', 2021],
  ['Bonnaroo Live 2010', 'The Avett Brothers', 2010],
  ['Live, Vol. 3', 'The Avett Brothers', 2010],
  ['All Your\u2019n', 'Tyler Childers', 2019],
  ['Sailor\u2019s Guide to Earth', 'Sturgill Simpson', 2016],
  ['Kala', 'M.I.A', 2007],
]

function lookupYear(album: string, albumArtist: string, artist: string): number | null {
  const albumLower = (album || '').toLowerCase()
  const artistLower = ((albumArtist || artist || '') + '').toLowerCase()

  // Try direct pattern match first
  for (const [albumPattern, artistPattern, year] of yearMap) {
    const ap = albumPattern.toLowerCase()
    const artp = artistPattern.toLowerCase()
    if (albumLower.includes(ap) && (artp === '' || artistLower.includes(artp))) {
      return year
    }
  }

  // Try extracting year from folder name patterns like "2007 - Album" or "YYYY - Album Name"
  const yearFromFolder = albumLower.match(/^(\d{4})\s*[-–]\s*/)
  if (yearFromFolder) {
    const y = parseInt(yearFromFolder[1])
    if (y >= 1950 && y <= 2030) return y
  }

  // Try "Artist - YYYY - Album" pattern (year embedded in folder)
  const yearInMiddle = albumLower.match(/[-–]\s*(\d{4})\s*[-–]/)
  if (yearInMiddle) {
    const y = parseInt(yearInMiddle[1])
    if (y >= 1950 && y <= 2030) return y
  }

  return null
}

async function writeYearToFlac(filePath: string, year: number): Promise<void> {
  // Read existing tags
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'quiet', '-print_format', 'json', '-show_format', filePath
  ], { timeout: 10000 })
  const info = JSON.parse(stdout)
  const existingTags: Record<string, string> = info.format?.tags || {}

  // Check if year already set
  if (existingTags.DATE === String(year) || existingTags.date === String(year)) return

  const tmpPath = filePath + '.tmp.' + Date.now() + '.flac'
  const args = ['-y', '-i', filePath, '-map', '0', '-map_metadata', '-1', '-c', 'copy']

  // Preserve all existing tags, skip date
  for (const [k, v] of Object.entries(existingTags)) {
    if (k.toLowerCase() !== 'date' && k.toLowerCase() !== 'year') {
      args.push('-metadata', `${k}=${v}`)
    }
  }
  // Add year
  args.push('-metadata', `DATE=${year}`)
  args.push(tmpPath)

  await execFileAsync(ffmpegPath, args, { timeout: 30000 })
  // Replace original
  let retries = 3
  while (retries > 0) {
    try {
      fs.renameSync(tmpPath, filePath)
      break
    } catch (e: any) {
      if (e.code === 'EPERM' && retries > 1) {
        await new Promise(r => setTimeout(r, 1000))
        retries--
      } else {
        // Cleanup tmp on failure
        try { fs.unlinkSync(tmpPath) } catch {}
        throw e
      }
    }
  }
}

function writeYearToMp3(filePath: string, year: number): void {
  const existing = NodeID3.read(filePath)
  if (existing.year === String(year)) return
  NodeID3.update({ year: String(year) }, filePath)
}

async function main() {
  console.log(`Backfilling album years into file tags...`)
  console.log(`Library: ${MUSIC_DIR}`)
  if (dryRun) console.log('DRY RUN — no files will be modified\n')

  const musicDir = MUSIC_DIR

  // Collect all audio files
  const topLevel = fs.readdirSync(musicDir, { withFileTypes: true })
  let totalFiles = 0
  let updated = 0
  let skipped = 0
  let errors = 0
  const unmatched = new Set<string>()

  for (const artistEntry of topLevel) {
    if (!artistEntry.isDirectory() || artistEntry.name === 'Playlists') continue
    const artistDir = path.join(musicDir, artistEntry.name)
    let albumEntries: fs.Dirent[]
    try { albumEntries = fs.readdirSync(artistDir, { withFileTypes: true }) } catch { continue }

    for (const albumEntry of albumEntries) {
      if (!albumEntry.isDirectory()) continue
      const albumDir = path.join(artistDir, albumEntry.name)
      let files: string[]
      try { files = fs.readdirSync(albumDir) } catch { continue }

      const audioFiles = files.filter(f => /\.(mp3|flac)$/i.test(f))
      if (audioFiles.length === 0) continue

      const year = lookupYear(albumEntry.name, artistEntry.name, '')
      if (!year) {
        unmatched.add(`${artistEntry.name} | ${albumEntry.name}`)
        continue
      }

      for (const file of audioFiles) {
        totalFiles++
        const filePath = path.join(albumDir, file).replace(/\\/g, '/')
        const ext = path.extname(file).toLowerCase()

        if (dryRun) {
          console.log(`  [DRY] ${year} → ${artistEntry.name}/${albumEntry.name}/${file}`)
          updated++
          continue
        }

        try {
          if (ext === '.flac') {
            await writeYearToFlac(filePath, year)
          } else if (ext === '.mp3') {
            writeYearToMp3(filePath, year)
          }
          updated++
        } catch (e: any) {
          console.error(`  ERROR: ${filePath}: ${e.message}`)
          errors++
        }
      }
    }
  }

  console.log(`\nDone! Updated ${updated} files, ${errors} errors, ${skipped} skipped`)
  console.log(`\nUnmatched albums (${unmatched.size}):`)
  for (const u of [...unmatched].sort()) {
    console.log(`  ${u}`)
  }

  // Also update library DB
  if (!dryRun) {
    const libDb = new Database(path.join(musicDir, 'library.db'))
    const tracks = libDb.prepare('SELECT id, album, artist, album_artist, file_path FROM tracks WHERE year = 0 OR year IS NULL').all() as any[]
    let dbUpdated = 0
    const updateStmt = libDb.prepare('UPDATE tracks SET year = ? WHERE id = ?')
    for (const t of tracks) {
      const year = lookupYear(t.album, t.album_artist || t.artist, t.artist)
      if (year) {
        updateStmt.run(year, t.id)
        dbUpdated++
      }
    }
    libDb.close()
    console.log(`\nLibrary DB: updated ${dbUpdated} tracks with year`)
  }

  // Trigger Navidrome scan
  if (!dryRun) {
    try {
      const resp = await fetch('http://localhost:4533/rest/startScan.view?u=admin&p=ADMIN&c=music-library&v=1.16.1&f=json')
      console.log('\nTriggered Navidrome scan:', resp.ok ? 'OK' : 'FAILED')
    } catch (e: any) {
      console.log('\nCould not trigger Navidrome scan:', e.message)
    }
  }
}

main().catch(console.error)
