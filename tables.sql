-- Step 1: Create a table for user profiles to store extra metadata
-- User ID (auth.users.id) ko primary key aur foreign key banaya jata hai.
CREATE TABLE public.profiles (
  id uuid REFERENCES auth.users NOT NULL PRIMARY KEY,
  username text UNIQUE,
  avatar_url text,
  full_name text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Step 2: Create a general purpose 'items' table
CREATE TABLE public.items (
  item_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  description text,
  price numeric(10, 2) NOT NULL,
  is_available boolean DEFAULT TRUE
);

-- Step 3: Enable Row Level Security (RLS) for all tables
-- RLS ko activate karna zaruri hai taakey users sirf apna data dekh sken.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

-- Step 4: Create RLS policies for the 'profiles' table
-- Users sirf apna profile data dekh aur update kar skte hain.
CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles
  FOR SELECT USING (TRUE);

CREATE POLICY "Users can insert their own profile." ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile." ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Step 5: Create RLS policies for the 'items' table
-- Items ko sab dekh skte hain, lekin sirf owner hi update/delete kar skta hai.
CREATE POLICY "Everyone can view items." ON public.items
  FOR SELECT USING (TRUE);

CREATE POLICY "Owners can create items." ON public.items
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can update their own items." ON public.items
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Owners can delete their own items." ON public.items
  FOR DELETE USING (auth.uid() = owner_id);

-- Optional: Set up function to auto-create profile on new user sign-up
-- This ensures a profile is created as soon as a user signs up.
CREATE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
