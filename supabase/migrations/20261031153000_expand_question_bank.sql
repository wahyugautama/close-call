-- Expand the online question bank with 54 additional estimation questions.
-- Keep this migration idempotent for projects where individual questions may
-- already have been added manually.

insert into public.game_questions (
  question,
  answer,
  explanation,
  category,
  difficulty
)
select
  seed.question,
  seed.answer,
  seed.explanation,
  seed.category,
  seed.difficulty
from (values
  -- Easy: familiar facts and short calculations.
  ('How many days are in a leap year?', 366, 'A leap year adds February 29, giving it 366 days.', 'time', 'easy'),
  ('How many continents are commonly recognized?', 7, 'The common model recognizes seven continents.', 'geography', 'easy'),
  ('How many planets are in the Solar System?', 8, 'The Solar System has eight recognized planets.', 'space', 'easy'),
  ('How many letters are in the English alphabet?', 26, 'The modern English alphabet contains 26 letters.', 'language', 'easy'),
  ('How many hours are in one week?', 168, 'Seven days multiplied by 24 hours equals 168.', 'time', 'easy'),
  ('How many sides does a dodecagon have?', 12, 'The prefix dodeca- denotes twelve.', 'math', 'easy'),
  ('How many rings are on the Olympic symbol?', 5, 'The Olympic symbol consists of five interlocking rings.', 'sports', 'easy'),
  ('How many teeth does a typical adult have including wisdom teeth?', 32, 'A complete adult dentition normally contains 32 teeth.', 'science', 'easy'),
  ('How many ounces are in one avoirdupois pound?', 16, 'One avoirdupois pound is divided into 16 ounces.', 'measurement', 'easy'),
  ('How many months have 31 days?', 7, 'January, March, May, July, August, October, and December have 31 days.', 'time', 'easy'),
  ('How many chambers does the human heart have?', 4, 'The heart has two atria and two ventricles.', 'science', 'easy'),
  ('How many zeroes are in one million?', 6, 'One million is written as 1,000,000.', 'math', 'easy'),
  ('How many players from one basketball team are on the court at once?', 5, 'Each basketball team fields five players at a time.', 'sports', 'easy'),
  ('How many colours are traditionally named in a rainbow?', 7, 'The traditional sequence names seven colours.', 'nature', 'easy'),
  ('How many feet are in one statute mile?', 5280, 'One statute mile equals 5,280 feet.', 'measurement', 'easy'),
  ('How many bits are in one byte?', 8, 'A standard byte contains eight bits.', 'technology', 'easy'),
  ('How many constituent countries make up the United Kingdom?', 4, 'The United Kingdom comprises England, Scotland, Wales, and Northern Ireland.', 'geography', 'easy'),
  ('How many strings does a standard violin have?', 4, 'A standard violin has four strings tuned G, D, A, and E.', 'music', 'easy'),

  -- Medium: less immediate facts and multi-step calculations.
  ('How many seconds are in one hour?', 3600, 'Sixty minutes multiplied by 60 seconds equals 3,600.', 'time', 'medium'),
  ('How many days are in a complete 400-year Gregorian calendar cycle?', 146097, 'A 400-year Gregorian cycle contains 303 common years and 97 leap years.', 'time', 'medium'),
  ('How many prime numbers are less than 100?', 25, 'There are 25 primes from 2 through 97.', 'math', 'medium'),
  ('What is the sum of all whole numbers from 1 through 100?', 5050, 'The arithmetic-series formula gives 100 × 101 ÷ 2 = 5,050.', 'math', 'medium'),
  ('How many faces does a regular icosahedron have?', 20, 'A regular icosahedron has 20 triangular faces.', 'math', 'medium'),
  ('How many edges does a cube have?', 12, 'A cube has four edges on each of three orientations, for 12 total.', 'math', 'medium'),
  ('How many people have walked on the Moon?', 12, 'Twelve Apollo astronauts walked on the lunar surface.', 'space', 'medium'),
  ('How many delegates signed the United States Declaration of Independence?', 56, 'The document bears the signatures of 56 delegates.', 'history', 'medium'),
  ('How many years elapsed from 1337 to 1453, the conventional span of the Hundred Years War?', 116, 'Subtracting 1337 from 1453 gives 116 elapsed years.', 'history', 'medium'),
  ('How many chapters, or surahs, are in the Quran?', 114, 'The Quran is organized into 114 surahs.', 'culture', 'medium'),
  ('How many sovereign countries are in South America?', 12, 'South America contains 12 sovereign states.', 'geography', 'medium'),
  ('How many official languages does the United Nations have?', 6, 'The UN has six official languages.', 'language', 'medium'),
  ('How many time zones does Russia span?', 11, 'Russia spans 11 time zones.', 'geography', 'medium'),
  ('How many bits are in an IPv6 address?', 128, 'IPv6 addresses are 128 bits long.', 'technology', 'medium'),
  ('How many bytes are in one kibibyte?', 1024, 'A kibibyte is exactly 2 to the tenth power bytes.', 'technology', 'medium'),
  ('How many pixels are in a 1920 by 1080 Full HD frame?', 2073600, 'Multiplying 1,920 by 1,080 gives 2,073,600 pixels.', 'technology', 'medium'),
  ('How many cards are in a standard tarot deck?', 78, 'A standard tarot deck has 22 Major Arcana and 56 Minor Arcana cards.', 'games', 'medium'),
  ('How many squares of every possible size are on an 8 by 8 chessboard?', 204, 'Adding 1 squared through 8 squared gives 204 squares.', 'games', 'medium'),

  -- Hard: large values, combinations, and specialist facts.
  ('How many milliseconds are in one day?', 86400000, 'There are 86,400 seconds in a day and 1,000 milliseconds per second.', 'time', 'hard'),
  ('How many minutes are in ten 365-day years?', 5256000, 'Ten × 365 × 24 × 60 equals 5,256,000 minutes.', 'time', 'hard'),
  ('Approximately how many kilometres is the average distance from Earth to the Moon?', 384400, 'The commonly cited average centre-to-centre distance is about 384,400 kilometres.', 'space', 'hard'),
  ('To the nearest metre, how high is Mount Everest above sea level?', 8849, 'The agreed elevation is 8,848.86 metres, which rounds to 8,849.', 'geography', 'hard'),
  ('Approximately how many metres deep is Challenger Deep?', 10935, 'Modern measurements place Challenger Deep at roughly 10,935 metres.', 'geography', 'hard'),
  ('Approximately how many kilometres is one astronomical unit?', 149597870, 'One astronomical unit is approximately 149,597,870 kilometres.', 'space', 'hard'),
  ('How many metres does light travel in a vacuum in one second?', 299792458, 'The speed of light is defined as exactly 299,792,458 metres per second.', 'science', 'hard'),
  ('How many seconds are in one Julian year of exactly 365.25 days?', 31557600, 'Multiplying 365.25 days by 86,400 seconds gives 31,557,600.', 'time', 'hard'),
  ('How many distinct IPv4 addresses are mathematically possible?', 4294967296, 'IPv4 uses 32 bits, allowing 2 to the 32nd power addresses.', 'technology', 'hard'),
  ('How many possible six-digit codes exist when leading zeroes and repetition are allowed?', 1000000, 'Six positions with ten choices each give 10 to the sixth power codes.', 'math', 'hard'),
  ('How many possible outcomes are there when ten six-sided dice are rolled?', 60466176, 'Six to the tenth power equals 60,466,176.', 'games', 'hard'),
  ('How many ways can twelve distinct objects be arranged in a row?', 479001600, 'Twelve factorial equals 479,001,600.', 'math', 'hard'),
  ('How many combinations are possible when choosing 6 numbers from 49?', 13983816, 'The combination 49 choose 6 equals 13,983,816.', 'math', 'hard'),
  ('How many nanoseconds are in one second?', 1000000000, 'The prefix nano- represents one billionth, so a second has one billion nanoseconds.', 'science', 'hard'),
  ('Approximately how many square kilometres is Earth''s total surface area?', 510072000, 'Earth''s total surface area is approximately 510,072,000 square kilometres.', 'science', 'hard'),
  ('How many litres fill an Olympic-size pool measuring 50 by 25 by 2 metres?', 2500000, 'The pool holds 2,500 cubic metres, or 2,500,000 litres.', 'sports', 'hard'),
  ('How many centimetres long is an official marathon?', 4219500, 'A marathon is 42,195 metres, and each metre contains 100 centimetres.', 'sports', 'hard'),
  ('How many heartbeats occur in one day at a constant rate of 70 beats per minute?', 100800, 'Seventy × 60 × 24 equals 100,800 beats.', 'science', 'hard')
) as seed(question, answer, explanation, category, difficulty)
where not exists (
  select 1
  from public.game_questions existing
  where existing.question = seed.question
);

